import asyncio
import dataclasses
import logging
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.models import SyncRun
from app.core.schemas import (
    ArtistSyncKindResult,
    ArtistSyncResult,
    EventSyncResult,
    PlaylistSyncItem,
    PlaylistSyncResult,
    SuggestionSyncResult,
    SyncStepProgress,
    TombstoneDrainResult,
)
from app.sync import sync_pipeline
from app.sync.sync_pipeline import (
    STEP_SPECS,
    STEP_UNFINISHED,
    _summarize_events,
    _summarize_playlists,
    dispatch_nightly_syncs,
    pending_steps,
    run_sync,
)
from app.sync.sync_runs import SyncRunLost
from app.sync.sync_steps import STEP_FAILED_SUGGESTIONS, SyncStepError, SyncSteps

USER_ID = uuid.uuid7()
OTHER_USER_ID = uuid.uuid7()
SYNCED_AT = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)

ARTIST_RESULT = ArtistSyncResult(
    synced_at=SYNCED_AT,
    results=[
        ArtistSyncKindResult(
            kind="lastfm_top_artist",
            artists=3,
            interests_created=2,
            interests_updated=1,
            interests_removed=0,
        ),
        ArtistSyncKindResult(
            kind="lastfm_loved_tracks",
            artists=1,
            interests_created=1,
            interests_updated=0,
            interests_removed=0,
        ),
    ],
)

SUGGESTION_RESULT = SuggestionSyncResult(
    synced_at=SYNCED_AT,
    seeds_total=5,
    seeds_synced=3,
    seeds_skipped=2,
    seeds_failed=0,
    candidates_scored=40,
    suggestions_created=10,
    suggestions_kept=5,
    suggestions_removed=1,
    artists_enriched=12,
    artists_enrich_failed=0,
)

EVENT_RESULT = EventSyncResult(
    synced_at=SYNCED_AT,
    artists_total=14,
    artists_synced=10,
    artists_skipped=3,
    artists_unknown=1,
    artists_failed=0,
    events_created=4,
    events_updated=2,
    events_removed=1,
    events_total=37,
)

PLAYLIST_RESULT = PlaylistSyncResult(
    synced_at=SYNCED_AT,
    artists_matched=6,
    artists_resolved=5,
    artists_unresolved=1,
    top_tracks_refreshed=5,
    playlists=[],
)

STEP_ORDER = ["sync_artists", "sync_suggestions", "sync_events", "sync_playlists"]

type StepOverride = Callable[[uuid.UUID], Awaitable[object]]


class FakeSteps(SyncSteps):
    """Records step calls and returns canned results, unless a step is
    overridden with a coroutine function (which may raise)."""

    def __init__(self, **overrides: StepOverride) -> None:
        super().__init__(MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock())
        self.calls: list[str] = []
        self._overrides = overrides
        self.due: list[uuid.UUID] = []
        self.drain_result = TombstoneDrainResult(drained=0, pending=0)
        self.orphans_found = 0
        self.cleanup_calls: list[str] = []
        self.drain_error: Exception | None = None

    async def _step[T](self, name: str, user_id: uuid.UUID, default: T) -> T:
        self.calls.append(name)
        override = self._overrides.get(name)
        if override is None:
            return default
        return cast(T, await override(user_id))

    async def sync_artists(self, user_id: uuid.UUID) -> ArtistSyncResult:
        return await self._step("sync_artists", user_id, ARTIST_RESULT)

    async def sync_suggestions(self, user_id: uuid.UUID) -> SuggestionSyncResult:
        return await self._step("sync_suggestions", user_id, SUGGESTION_RESULT)

    async def sync_events(self, user_id: uuid.UUID) -> EventSyncResult:
        return await self._step("sync_events", user_id, EVENT_RESULT)

    async def sync_playlists(self, user_id: uuid.UUID) -> PlaylistSyncResult:
        return await self._step("sync_playlists", user_id, PLAYLIST_RESULT)

    async def list_users_due_for_sync(self) -> list[uuid.UUID]:
        return list(self.due)

    async def drain_playlist_tombstones(self) -> TombstoneDrainResult:
        self.cleanup_calls.append("drain")
        if self.drain_error is not None:
            raise self.drain_error
        return self.drain_result

    async def audit_bot_playlists(self) -> int:
        self.cleanup_calls.append("audit")
        return self.orphans_found


class FakeStore:
    """Stands in for the `sync_runs` writes: keeps every progress snapshot
    and the terminal write, and can pretend the lease was lost."""

    def __init__(self) -> None:
        self.progress: list[list[SyncStepProgress]] = []
        self.finished: tuple[str, list[SyncStepProgress], str | None] | None = None
        self.heartbeats = 0
        self.requeued = False
        self.lost = False

    async def record_step_progress(self, session, run, steps) -> None:
        if self.lost:
            raise SyncRunLost(run.id)
        self.progress.append([step.model_copy() for step in steps])

    async def heartbeat_sync_run(self, session, run) -> None:
        if self.lost:
            raise SyncRunLost(run.id)
        self.heartbeats += 1

    async def finish_sync_run(self, session, run, steps, status, error=None) -> None:
        if self.lost:
            raise SyncRunLost(run.id)
        self.finished = (status, [step.model_copy() for step in steps], error)

    async def requeue_sync_run(self, session, run) -> None:
        self.requeued = True

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        @asynccontextmanager
        async def factory():
            yield AsyncMock()

        monkeypatch.setattr(sync_pipeline, "session_factory", factory)
        for name in (
            "record_step_progress",
            "heartbeat_sync_run",
            "finish_sync_run",
            "requeue_sync_run",
        ):
            monkeypatch.setattr(sync_pipeline, name, getattr(self, name))


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    fake = FakeStore()
    fake.install(monkeypatch)
    # Retries and heartbeats at test speed.
    monkeypatch.setattr(sync_pipeline, "INITIAL_BACKOFF", timedelta(0))
    monkeypatch.setattr(sync_pipeline, "HEARTBEAT_INTERVAL", timedelta(milliseconds=10))
    return fake


def make_run(steps: list[SyncStepProgress] | None = None) -> SyncRun:
    progress = steps if steps is not None else pending_steps()
    return SyncRun(
        id=uuid.uuid7(),
        user_id=USER_ID,
        trigger="manual",
        status="running",
        steps=[step.model_dump(mode="json") for step in progress],
        claim_id=uuid.uuid4(),
        created_at=SYNCED_AT,
    )


def failing(message: str, *, retryable: bool = True, times: int | None = None) -> StepOverride:
    """A step that raises `times` times (forever when None) and then succeeds."""
    remaining = times

    async def step(user_id: uuid.UUID) -> object:
        nonlocal remaining
        if remaining is None or remaining > 0:
            if remaining is not None:
                remaining -= 1
            raise SyncStepError(message, retryable=retryable)
        return SUGGESTION_RESULT

    return step


def statuses(steps: list[SyncStepProgress]) -> list[str]:
    return [step.status for step in steps]


# --- run_sync ---


async def test_run_sync_runs_all_steps_in_order(store: FakeStore) -> None:
    steps = FakeSteps()

    outcome = await run_sync(make_run(), steps)

    assert outcome == "completed"
    assert steps.calls == STEP_ORDER
    assert store.finished is not None
    status, final, error = store.finished
    assert status == "completed"
    assert error is None
    assert statuses(final) == ["completed"] * 4
    assert [step.summary for step in final] == [
        "Imported 4 artists · 3 added",
        "Suggested 15 artists · 10 added, 1 removed",
        "Found 37 concerts · 4 added, 1 removed",
        "Generated 0 playlists",
    ]
    assert all(step.finished_at is not None for step in final)
    # Progress is written as each step starts and finishes, live for the API.
    assert statuses(store.progress[0]) == ["running", "pending", "pending", "pending"]
    assert statuses(store.progress[1]) == ["completed", "pending", "pending", "pending"]
    assert statuses(store.progress[2]) == ["completed", "running", "pending", "pending"]


async def test_run_sync_stops_at_first_failed_step(store: FakeStore) -> None:
    steps = FakeSteps(sync_suggestions=failing("Last.fm exploded", retryable=False))

    outcome = await run_sync(make_run(), steps)

    assert outcome == "failed"
    assert steps.calls == ["sync_artists", "sync_suggestions"]
    assert store.finished is not None
    status, final, error = store.finished
    assert status == "failed"
    assert statuses(final) == ["completed", "failed", "pending", "pending"]
    assert final[1].summary == "Last.fm exploded"
    assert final[1].finished_at is not None
    assert final[2].finished_at is None
    assert error is not None and "Last.fm exploded" in error


async def test_run_sync_retries_retryable_failures(store: FakeStore) -> None:
    steps = FakeSteps(sync_suggestions=failing(STEP_FAILED_SUGGESTIONS, times=2))

    outcome = await run_sync(make_run(), steps)

    assert outcome == "completed"
    assert steps.calls.count("sync_suggestions") == 3


async def test_run_sync_gives_up_after_max_attempts(store: FakeStore) -> None:
    steps = FakeSteps(sync_suggestions=failing(STEP_FAILED_SUGGESTIONS))

    outcome = await run_sync(make_run(), steps)

    assert outcome == "failed"
    assert steps.calls.count("sync_suggestions") == sync_pipeline.MAX_ATTEMPTS
    assert store.finished is not None
    assert store.finished[1][1].summary == STEP_FAILED_SUGGESTIONS


async def test_run_sync_does_not_retry_non_retryable_failures(store: FakeStore) -> None:
    steps = FakeSteps(sync_suggestions=failing("rj's listening data is private", retryable=False))

    outcome = await run_sync(make_run(), steps)

    assert outcome == "failed"
    assert steps.calls.count("sync_suggestions") == 1


async def test_run_sync_times_out_a_stuck_step(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    quick = tuple(
        dataclasses.replace(spec, attempt_timeout=timedelta(milliseconds=20)) for spec in STEP_SPECS
    )
    monkeypatch.setattr(sync_pipeline, "STEP_SPECS", quick)
    monkeypatch.setattr(sync_pipeline, "RETRY_MARGIN", timedelta(0))

    async def stuck(user_id: uuid.UUID) -> object:
        await asyncio.sleep(10)
        return EVENT_RESULT

    steps = FakeSteps(sync_events=stuck)

    with caplog.at_level(logging.WARNING, logger="app.sync.sync_pipeline"):
        outcome = await run_sync(make_run(), steps)

    assert outcome == "failed"
    assert store.finished is not None
    status, final, error = store.finished
    assert statuses(final) == ["completed", "completed", "failed", "pending"]
    assert final[2].summary == STEP_UNFINISHED
    assert error is not None and "TimeoutError" in error
    assert "Sync step events timed out" in caplog.text


async def test_run_sync_resumes_from_completed_steps(store: FakeStore) -> None:
    progress = pending_steps()
    progress[0].status = "completed"
    progress[0].summary = "Imported 4 artists"
    progress[0].finished_at = SYNCED_AT
    progress[1].status = "running"
    steps = FakeSteps()

    outcome = await run_sync(make_run(progress), steps)

    assert outcome == "completed"
    assert steps.calls == ["sync_suggestions", "sync_events", "sync_playlists"]
    assert store.finished is not None
    assert store.finished[1][0].summary == "Imported 4 artists"


async def test_run_sync_fails_run_when_pipeline_itself_breaks(
    store: FakeStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(result: object) -> str:
        raise KeyError("summary")

    specs = list(STEP_SPECS)
    specs[0] = dataclasses.replace(specs[0], summarize=broken)
    monkeypatch.setattr(sync_pipeline, "STEP_SPECS", tuple(specs))
    steps = FakeSteps()

    outcome = await run_sync(make_run(), steps)

    assert outcome == "failed"
    assert store.finished is not None
    status, final, error = store.finished
    assert statuses(final) == ["failed", "pending", "pending", "pending"]
    assert final[0].summary == STEP_UNFINISHED
    assert error is not None and "KeyError" in error


async def test_run_sync_abandons_a_run_taken_over_by_another_worker(store: FakeStore) -> None:
    started = asyncio.Event()

    async def slow(user_id: uuid.UUID) -> object:
        started.set()
        await asyncio.sleep(10)
        return ARTIST_RESULT

    steps = FakeSteps(sync_artists=slow)
    run_task = asyncio.create_task(run_sync(make_run(), steps))
    await started.wait()
    store.lost = True

    outcome = await asyncio.wait_for(run_task, timeout=2)

    assert outcome is None
    assert store.finished is None
    assert store.requeued is False


async def test_run_sync_requeues_on_cancellation(store: FakeStore) -> None:
    started = asyncio.Event()

    async def slow(user_id: uuid.UUID) -> object:
        started.set()
        await asyncio.sleep(10)
        return ARTIST_RESULT

    steps = FakeSteps(sync_artists=slow)
    run_task = asyncio.create_task(run_sync(make_run(), steps))
    await started.wait()
    run_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await run_task
    assert store.requeued is True
    assert store.finished is None


async def test_run_sync_keeps_the_heartbeat_fresh(store: FakeStore) -> None:
    async def slow(user_id: uuid.UUID) -> object:
        await asyncio.sleep(0.1)
        return ARTIST_RESULT

    steps = FakeSteps(sync_artists=slow)

    await run_sync(make_run(), steps)

    assert store.heartbeats >= 3


# --- summaries ---


def test_step_summaries_drop_zero_delta_clauses() -> None:
    quiet = EVENT_RESULT.model_copy(update={"events_created": 0, "events_removed": 0})
    assert _summarize_events(quiet) == "Found 37 concerts"
    removals_only = EVENT_RESULT.model_copy(update={"events_created": 0})
    assert _summarize_events(removals_only) == "Found 37 concerts · 1 removed"


def test_playlist_summary_deltas_name_tracks() -> None:
    playlist = PlaylistSyncItem(
        playlist_id=uuid.uuid7(),
        name="NextFM · Montréal",
        status="synced",
        tracks_added=1,
        tracks_removed=0,
        tracks_total=1,
    )
    result = PLAYLIST_RESULT.model_copy(update={"playlists": [playlist]})
    assert _summarize_playlists(result) == "Generated 1 playlist · 1 track added"
    both = playlist.model_copy(update={"tracks_added": 3, "tracks_removed": 2})
    result = PLAYLIST_RESULT.model_copy(update={"playlists": [both]})
    assert _summarize_playlists(result) == "Generated 1 playlist · 3 tracks added, 2 removed"


# --- dispatch_nightly_syncs ---


class FakeDispatch:
    """Stands in for the nightly dispatch's queue writes and run execution."""

    def __init__(self, in_flight: frozenset[uuid.UUID] = frozenset()) -> None:
        self.in_flight = set(in_flight)
        self.started: list[uuid.UUID] = []
        self.ran: list[uuid.UUID] = []
        self.outcomes: dict[uuid.UUID, object] = {}
        self.pruned = 0

    async def start_nightly_sync_run(self, session, user_id, steps) -> SyncRun | None:
        self.started.append(user_id)
        if user_id in self.in_flight:
            return None
        run = make_run(steps)
        run.user_id = user_id
        run.trigger = "nightly"
        return run

    async def run_sync(self, run: SyncRun, steps: SyncSteps) -> object:
        self.ran.append(run.user_id)
        outcome = self.outcomes.get(run.user_id, "completed")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def prune_sync_runs(self, session) -> int:
        self.pruned += 1
        return 3

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        @asynccontextmanager
        async def factory():
            yield AsyncMock()

        monkeypatch.setattr(sync_pipeline, "session_factory", factory)
        monkeypatch.setattr(sync_pipeline, "INITIAL_BACKOFF", timedelta(0))
        for name in ("start_nightly_sync_run", "run_sync", "prune_sync_runs"):
            monkeypatch.setattr(sync_pipeline, name, getattr(self, name))


async def test_dispatch_syncs_each_due_user_in_order(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    dispatch = FakeDispatch()
    dispatch.install(monkeypatch)
    steps = FakeSteps()
    steps.due = [USER_ID, OTHER_USER_ID]
    steps.drain_result = TombstoneDrainResult(drained=2, pending=1)
    steps.orphans_found = 1

    with caplog.at_level(logging.INFO, logger="app.sync.sync_pipeline"):
        await dispatch_nightly_syncs(steps)

    assert dispatch.ran == [USER_ID, OTHER_USER_ID]
    # Users run to completion one at a time, then the cleanup: drain, audit, prune.
    assert steps.cleanup_calls == ["drain", "audit"]
    assert dispatch.pruned == 1
    assert "2 synced, 0 failed, 0 skipped" in caplog.text
    assert "2 tombstones drained (1 pending)" in caplog.text
    assert "audit found 1 orphaned playlists" in caplog.text


async def test_dispatch_skips_users_with_a_run_in_flight(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    dispatch = FakeDispatch(in_flight=frozenset({USER_ID}))
    dispatch.install(monkeypatch)
    steps = FakeSteps()
    steps.due = [USER_ID, OTHER_USER_ID]

    with caplog.at_level(logging.INFO, logger="app.sync.sync_pipeline"):
        await dispatch_nightly_syncs(steps)

    assert dispatch.started == [USER_ID, OTHER_USER_ID]
    assert dispatch.ran == [OTHER_USER_ID]
    assert "1 synced, 0 failed, 1 skipped" in caplog.text


async def test_dispatch_isolates_one_users_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    dispatch = FakeDispatch()
    dispatch.install(monkeypatch)
    dispatch.outcomes[USER_ID] = RuntimeError("worker bug")
    steps = FakeSteps()
    steps.due = [USER_ID, OTHER_USER_ID]

    with caplog.at_level(logging.INFO, logger="app.sync.sync_pipeline"):
        await dispatch_nightly_syncs(steps)

    assert dispatch.ran == [USER_ID, OTHER_USER_ID]
    assert steps.cleanup_calls == ["drain", "audit"]
    assert "1 synced, 1 failed, 0 skipped" in caplog.text


async def test_dispatch_survives_cleanup_failure_and_still_audits(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    dispatch = FakeDispatch()
    dispatch.install(monkeypatch)
    steps = FakeSteps()
    steps.drain_error = RuntimeError("Spotify down")

    with caplog.at_level(logging.INFO, logger="app.sync.sync_pipeline"):
        await dispatch_nightly_syncs(steps)

    # The drain is retried, then given up on; the audit and prune still run.
    assert steps.cleanup_calls == ["drain"] * sync_pipeline.MAX_ATTEMPTS + ["audit"]
    assert dispatch.pruned == 1
    assert "Tombstone drain failed" in caplog.text
