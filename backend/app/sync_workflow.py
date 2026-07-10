"""The sync pipeline as Temporal workflows.

`SyncUserWorkflow` chains the four sync activities in dependency order
(artists -> suggestions -> events -> playlists) and keeps a per-step progress
list that the API reads through the `progress` query. Activities are referenced
by name so the workflow sandbox never imports the ORM or the API clients; the
result models pass through the pydantic data converter.

`DispatchSyncsWorkflow` is the nightly re-sync: fired by the `nightly-sync`
schedule (created at worker startup), it lists the users due for a sync and
runs each as a child `SyncUserWorkflow`, one at a time; afterwards it audits
the bot account for orphaned Spotify playlists and drains the unfollow
tombstones (docs/design/2026-07-10-playlist-deletion-plan.md).

See docs/design/2026-07-07-sync-orchestration-plan.md and
docs/design/2026-07-09-background-sync-plan.md.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import (
    ActivityError,
    ChildWorkflowError,
    FailureError,
    WorkflowAlreadyStartedError,
)

with workflow.unsafe.imports_passed_through():
    from app.schemas import (
        ArtistSyncResult,
        DispatchSyncsResult,
        EventSyncResult,
        PlaylistSyncResult,
        SuggestionSyncResult,
        SyncRunResult,
        SyncStepKey,
        SyncStepProgress,
        TombstoneDrainResult,
    )

RETRY_POLICY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=3,
    # An expired bot refresh token needs re-authorization, not a retry.
    # Hidden Last.fm listening data needs a settings change, not a retry.
    non_retryable_error_types=["SpotifyAuthError", "LastfmPrivateDataError"],
)


def user_sync_workflow_id(user_id: uuid.UUID) -> str:
    return f"user-sync-{user_id}"


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _summarize_artists(result: ArtistSyncResult) -> str:
    artists = sum(kind.artists for kind in result.results)
    created = sum(kind.interests_created for kind in result.results)
    updated = sum(kind.interests_updated for kind in result.results)
    removed = sum(kind.interests_removed for kind in result.results)
    return (
        f"Imported {_plural(artists, 'artist')} · "
        f"{created} added, {updated} updated, {removed} removed"
    )


def _summarize_suggestions(result: SuggestionSyncResult) -> str:
    failed = f", {result.seeds_failed} failed" if result.seeds_failed > 0 else ""
    seeds = f"{_plural(result.seeds_total, 'seed')} ({result.seeds_skipped} fresh{failed})"
    enrich_failed = (
        f" · {result.artists_enrich_failed} artist infos failed"
        if result.artists_enrich_failed > 0
        else ""
    )
    return (
        f"Scored {result.candidates_scored} candidates from {seeds} · "
        f"{result.suggestions_created} artists suggested, "
        f"{result.suggestions_kept} kept, {result.suggestions_removed} removed{enrich_failed}"
    )


def _summarize_events(result: EventSyncResult) -> str:
    failed = f", {result.artists_failed} failed" if result.artists_failed > 0 else ""
    checked = (
        f"Checked {_plural(result.artists_total, 'artist')} "
        f"({result.artists_skipped} fresh, {result.artists_unknown} not on Bandsintown{failed})"
    )
    return (
        f"{checked} · {result.events_created} concerts found, "
        f"{result.events_updated} updated, {result.events_removed} removed"
    )


def _summarize_playlists(result: PlaylistSyncResult) -> str:
    synced = [playlist for playlist in result.playlists if playlist.status == "synced"]
    # Track counts span every status: an emptied no-city playlist removes
    # tracks too, and the summary must explain where they went.
    added = sum(playlist.tracks_added for playlist in result.playlists)
    removed = sum(playlist.tracks_removed for playlist in result.playlists)
    unresolved = (
        f", {result.artists_unresolved} not found on Spotify"
        if result.artists_unresolved > 0
        else ""
    )
    return (
        f"Generated {_plural(len(synced), 'playlist')} · "
        f"{added} tracks added, {removed} removed · "
        f"{result.artists_matched} artists with concerts nearby{unresolved}"
    )


@dataclass(frozen=True)
class _StepSpec:
    key: SyncStepKey
    label: str
    activity: str
    result_type: type
    timeout: timedelta
    summarize: Callable[[Any], str]


STEP_SPECS = (
    _StepSpec(
        key="artists",
        label="Import listening history from Last.fm",
        activity="sync_artists",
        result_type=ArtistSyncResult,
        timeout=timedelta(minutes=2),
        summarize=_summarize_artists,
    ),
    _StepSpec(
        key="suggestions",
        label="Suggest artists",
        activity="sync_suggestions",
        result_type=SuggestionSyncResult,
        timeout=timedelta(minutes=15),
        summarize=_summarize_suggestions,
    ),
    _StepSpec(
        key="events",
        label="Find concerts",
        activity="sync_events",
        result_type=EventSyncResult,
        timeout=timedelta(minutes=15),
        summarize=_summarize_events,
    ),
    _StepSpec(
        key="playlists",
        label="Generate Spotify playlists",
        activity="sync_playlists",
        result_type=PlaylistSyncResult,
        timeout=timedelta(minutes=30),
        summarize=_summarize_playlists,
    ),
)


def pending_steps() -> list[SyncStepProgress]:
    return [
        SyncStepProgress(key=spec.key, label=spec.label, status="pending") for spec in STEP_SPECS
    ]


@workflow.defn
class SyncUserWorkflow:
    def __init__(self) -> None:
        self._steps = pending_steps()

    @workflow.run
    async def run(self, user_id: str) -> SyncRunResult:
        for step, spec in zip(self._steps, STEP_SPECS, strict=True):
            step.status = "running"
            try:
                result = await workflow.execute_activity(
                    spec.activity,
                    user_id,
                    result_type=spec.result_type,
                    # schedule_to_close bounds queue wait plus every retry, so
                    # a run can't sit RUNNING forever when no worker is polling.
                    schedule_to_close_timeout=spec.timeout,
                    retry_policy=RETRY_POLICY,
                )
            except ActivityError as exc:
                # Later steps consume this one's writes, so stop here; the
                # remaining steps stay pending and the run fails.
                step.status = "failed"
                if isinstance(exc.cause, FailureError):
                    step.summary = exc.cause.message
                raise
            step.status = "completed"
            step.summary = spec.summarize(result)
        # Bookkeeping, not a UI step: the stamp is what lets the nightly
        # dispatch skip users who synced recently, and it only lands when
        # every step succeeded so failing users stay first in line.
        await workflow.execute_activity(
            "record_sync_completed",
            user_id,
            schedule_to_close_timeout=timedelta(minutes=1),
            retry_policy=RETRY_POLICY,
        )
        return SyncRunResult(steps=self._steps)

    @workflow.query
    def progress(self) -> list[SyncStepProgress]:
        return self._steps


@workflow.defn
class DispatchSyncsWorkflow:
    @workflow.run
    async def run(self) -> DispatchSyncsResult:
        user_ids: list[str] = await workflow.execute_activity(
            "list_users_due_for_sync",
            result_type=list[str],
            schedule_to_close_timeout=timedelta(minutes=1),
            retry_policy=RETRY_POLICY,
        )
        succeeded = failed = skipped = 0
        for user_id in user_ids:
            try:
                await workflow.execute_child_workflow(
                    SyncUserWorkflow.run,
                    user_id,
                    id=user_sync_workflow_id(uuid.UUID(user_id)),
                )
            except WorkflowAlreadyStartedError:
                # A manual sync is in flight for this user; it does the job.
                skipped += 1
            except ChildWorkflowError:
                # One user's broken sync must not stall the rest of the fleet.
                failed += 1
            else:
                succeeded += 1
        # Each cleanup step stands alone: neither may fail the night's syncs,
        # and a broken audit (its endpoint is the design's one unverified
        # Spotify assumption) must not gate the drainer that the deletion
        # invariant rests on. Drain runs first for the same reason.
        drain = TombstoneDrainResult(drained=0, pending=0)
        try:
            drain = await workflow.execute_activity(
                "drain_playlist_tombstones",
                result_type=TombstoneDrainResult,
                schedule_to_close_timeout=timedelta(minutes=10),
                retry_policy=RETRY_POLICY,
            )
        except ActivityError:
            workflow.logger.exception("Tombstone drain failed; retrying next dispatch")
        orphans_found = 0
        try:
            orphans_found = await workflow.execute_activity(
                "audit_bot_playlists",
                result_type=int,
                schedule_to_close_timeout=timedelta(minutes=10),
                retry_policy=RETRY_POLICY,
            )
        except ActivityError:
            workflow.logger.exception("Bot-account audit failed; retrying next dispatch")
        return DispatchSyncsResult(
            dispatched=len(user_ids),
            succeeded=succeeded,
            failed=failed,
            skipped=skipped,
            orphans_found=orphans_found,
            tombstones_drained=drain.drained,
            tombstones_pending=drain.pending,
        )
