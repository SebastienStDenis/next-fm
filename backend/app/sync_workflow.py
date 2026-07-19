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
    ApplicationError,
    ChildWorkflowError,
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

# start_to_close bounds a single attempt; schedule_to_close is that plus this
# margin, so an attempt that fails late still leaves room for the retry policy
# (and so queue wait when no worker is polling stays bounded).
RETRY_MARGIN = timedelta(minutes=5)


def _schedule_to_close(attempt_timeout: timedelta) -> timedelta:
    return attempt_timeout + RETRY_MARGIN


def user_sync_workflow_id(user_id: uuid.UUID) -> str:
    return f"user-sync-{user_id}"


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _summarize_artists(result: ArtistSyncResult) -> str:
    artists = sum(kind.artists for kind in result.results)
    created = sum(kind.interests_created for kind in result.results)
    return f"Imported {_plural(artists, 'artist')} · {created} new"


def _summarize_suggestions(result: SuggestionSyncResult) -> str:
    total = result.suggestions_created + result.suggestions_kept
    return f"Suggested {_plural(total, 'artist')} · {result.suggestions_created} new"


def _summarize_events(result: EventSyncResult) -> str:
    return f"Found {_plural(result.events_created, 'new concert')}"


def _summarize_playlists(result: PlaylistSyncResult) -> str:
    synced = [playlist for playlist in result.playlists if playlist.status == "synced"]
    # Track counts span every status: an emptied no-city playlist removes
    # tracks too, and the summary must explain where they went.
    added = sum(playlist.tracks_added for playlist in result.playlists)
    removed = sum(playlist.tracks_removed for playlist in result.playlists)
    return f"Generated {_plural(len(synced), 'playlist')} · {added} tracks added, {removed} removed"


@dataclass(frozen=True)
class _StepSpec:
    key: SyncStepKey
    label: str
    activity: str
    result_type: type
    attempt_timeout: timedelta
    summarize: Callable[[Any], str]


STEP_SPECS = (
    _StepSpec(
        key="artists",
        label="Import listening history from Last.fm",
        activity="sync_artists",
        result_type=ArtistSyncResult,
        attempt_timeout=timedelta(minutes=2),
        summarize=_summarize_artists,
    ),
    _StepSpec(
        key="suggestions",
        label="Suggest artists",
        activity="sync_suggestions",
        result_type=SuggestionSyncResult,
        attempt_timeout=timedelta(minutes=15),
        summarize=_summarize_suggestions,
    ),
    _StepSpec(
        key="events",
        label="Find concerts",
        activity="sync_events",
        result_type=EventSyncResult,
        attempt_timeout=timedelta(minutes=15),
        summarize=_summarize_events,
    ),
    _StepSpec(
        key="playlists",
        label="Generate Spotify playlists",
        activity="sync_playlists",
        result_type=PlaylistSyncResult,
        attempt_timeout=timedelta(minutes=30),
        summarize=_summarize_playlists,
    ),
)


def pending_steps() -> list[SyncStepProgress]:
    return [
        SyncStepProgress(key=spec.key, label=spec.label, status="pending") for spec in STEP_SPECS
    ]


def _failure_summary(exc: ActivityError) -> str:
    # Activities phrase their own failures for the user (see
    # app.sync_activities._user_facing_errors), so an ApplicationError message
    # is safe to show. Timeouts and cancellations carry no such message, so
    # they fall back to a generic line rather than leaking Temporal internals.
    cause = exc.cause
    if isinstance(cause, ApplicationError) and cause.message:
        return cause.message
    return "This step didn't finish. Please try again."


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
                    # start_to_close bounds one attempt so a single slow run
                    # can't consume the whole budget with no room left to retry;
                    # schedule_to_close is the outer cap on queue wait plus every
                    # attempt, so a run can't sit RUNNING forever with no worker.
                    start_to_close_timeout=spec.attempt_timeout,
                    schedule_to_close_timeout=_schedule_to_close(spec.attempt_timeout),
                    retry_policy=RETRY_POLICY,
                )
            except ActivityError as exc:
                # Later steps consume this one's writes, so stop here; the
                # remaining steps stay pending and the run fails.
                step.status = "failed"
                step.finished_at = workflow.now()
                step.summary = _failure_summary(exc)
                raise
            step.status = "completed"
            step.finished_at = workflow.now()
            step.summary = spec.summarize(result)
        # Bookkeeping, not a UI step: the stamp is what lets the nightly
        # dispatch skip users who synced recently, and it only lands when
        # every step succeeded so failing users stay first in line.
        await workflow.execute_activity(
            "record_sync_completed",
            user_id,
            start_to_close_timeout=timedelta(minutes=1),
            schedule_to_close_timeout=_schedule_to_close(timedelta(minutes=1)),
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
            start_to_close_timeout=timedelta(minutes=1),
            schedule_to_close_timeout=_schedule_to_close(timedelta(minutes=1)),
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
                start_to_close_timeout=timedelta(minutes=10),
                schedule_to_close_timeout=_schedule_to_close(timedelta(minutes=10)),
                retry_policy=RETRY_POLICY,
            )
        except ActivityError:
            workflow.logger.exception("Tombstone drain failed; retrying next dispatch")
        orphans_found = 0
        try:
            orphans_found = await workflow.execute_activity(
                "audit_bot_playlists",
                result_type=int,
                start_to_close_timeout=timedelta(minutes=10),
                schedule_to_close_timeout=_schedule_to_close(timedelta(minutes=10)),
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
