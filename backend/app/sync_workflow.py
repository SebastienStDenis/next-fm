"""The per-user sync pipeline as a Temporal workflow.

`SyncUserWorkflow` chains the four sync activities in dependency order
(artists -> suggestions -> events -> playlists) and keeps a per-step progress
list that the API reads through the `progress` query. Activities are referenced
by name so the workflow sandbox never imports the ORM or the API clients; the
result models pass through the pydantic data converter.

See docs/2026-07-07-sync-orchestration-plan.md.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, FailureError

with workflow.unsafe.imports_passed_through():
    from app.schemas import (
        ArtistSyncResult,
        EventSyncResult,
        PlaylistSyncResult,
        SuggestionSyncResult,
        SyncRunResult,
        SyncStepKey,
        SyncStepProgress,
    )

RETRY_POLICY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=3,
    # An expired bot refresh token needs re-authorization, not a retry.
    non_retryable_error_types=["SpotifyAuthError"],
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
        f"Synced {_plural(artists, 'artist')} · "
        f"{created} added, {updated} updated, {removed} removed"
    )


def _summarize_suggestions(result: SuggestionSyncResult) -> str:
    failed = f", {result.seeds_failed} failed" if result.seeds_failed > 0 else ""
    seeds = f"{_plural(result.seeds_total, 'seed')} ({result.seeds_skipped} fresh{failed})"
    return (
        f"Scored {result.candidates_scored} candidates from {seeds} · "
        f"{result.suggestions_created} suggestions added, "
        f"{result.suggestions_kept} kept, {result.suggestions_removed} removed"
    )


def _summarize_events(result: EventSyncResult) -> str:
    failed = f", {result.artists_failed} failed" if result.artists_failed > 0 else ""
    checked = (
        f"Checked {_plural(result.artists_total, 'artist')} "
        f"({result.artists_skipped} fresh, {result.artists_unknown} not on Bandsintown{failed})"
    )
    return (
        f"{checked} · {result.events_created} events added, "
        f"{result.events_updated} updated, {result.events_removed} removed"
    )


def _summarize_playlists(result: PlaylistSyncResult) -> str:
    synced = [playlist for playlist in result.playlists if playlist.status == "synced"]
    added = sum(playlist.tracks_added for playlist in synced)
    removed = sum(playlist.tracks_removed for playlist in synced)
    unresolved = (
        f", {result.artists_unresolved} not found on Spotify"
        if result.artists_unresolved > 0
        else ""
    )
    return (
        f"Synced {_plural(len(synced), 'playlist')} · "
        f"{added} tracks added, {removed} removed · "
        f"{result.artists_matched} artists with shows nearby{unresolved}"
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
        label="Sync Last.fm artists",
        activity="sync_artists",
        result_type=ArtistSyncResult,
        timeout=timedelta(minutes=2),
        summarize=_summarize_artists,
    ),
    _StepSpec(
        key="suggestions",
        label="Refresh suggested artists",
        activity="sync_suggestions",
        result_type=SuggestionSyncResult,
        timeout=timedelta(minutes=15),
        summarize=_summarize_suggestions,
    ),
    _StepSpec(
        key="events",
        label="Find upcoming concerts",
        activity="sync_events",
        result_type=EventSyncResult,
        timeout=timedelta(minutes=15),
        summarize=_summarize_events,
    ),
    _StepSpec(
        key="playlists",
        label="Update Spotify playlists",
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
        return SyncRunResult(steps=self._steps)

    @workflow.query
    def progress(self) -> list[SyncStepProgress]:
        return self._steps
