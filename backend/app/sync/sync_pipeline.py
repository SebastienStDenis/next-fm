"""The sync pipeline: which steps make up a run, how a claimed run is
executed, and the nightly dispatch that runs every due user.

`run_sync` chains the four steps in dependency order (artists -> suggestions
-> events -> playlists), retrying each with backoff and timeouts, and writes
the per-step progress to the run row after every change so the API serves it
live. `dispatch_nightly_syncs` is the nightly re-sync: it runs each due user
one at a time, then drains the unfollow tombstones and audits the bot account
for orphaned playlists (docs/design/2026-07-10-playlist-deletion-plan.md).

See docs/design/2026-08-16-postgres-sync-queue-plan.md.
"""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any, Literal

from app.core.db import session_factory
from app.core.models import SyncRun
from app.core.schemas import (
    ArtistSyncResult,
    EventSyncResult,
    PlaylistSyncResult,
    SuggestionSyncResult,
    SyncStepKey,
    SyncStepProgress,
    TombstoneDrainResult,
)
from app.sync.sync_runs import (
    SyncRunLost,
    finish_sync_run,
    heartbeat_sync_run,
    prune_sync_runs,
    record_step_progress,
    requeue_sync_run,
    run_steps,
    start_nightly_sync_run,
)
from app.sync.sync_steps import SyncStepError, SyncSteps

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
INITIAL_BACKOFF = timedelta(seconds=1)
BACKOFF_COEFFICIENT = 2.0
MAX_BACKOFF = timedelta(seconds=30)
# The attempt timeout bounds a single attempt; the whole step (every attempt
# and the backoff between them) gets that plus this margin, so a first attempt
# that fails late still leaves room to retry without letting the step run on
# unbounded.
RETRY_MARGIN = timedelta(minutes=5)
CLEANUP_TIMEOUT = timedelta(minutes=10)

HEARTBEAT_INTERVAL = timedelta(seconds=30)

STEP_UNFINISHED = "This step didn't finish. Please try again."

SyncOutcome = Literal["completed", "failed"]


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _with_deltas(headline: str, added: int, removed: int, noun: str = "") -> str:
    """Append " · {added} added, {removed} removed" to the headline, dropping
    zero clauses; the noun (when given) labels only the first clause shown."""
    parts = []
    for count, verb in ((added, "added"), (removed, "removed")):
        if count:
            label = f"{_plural(count, noun)} {verb}" if noun and not parts else f"{count} {verb}"
            parts.append(label)
    return f"{headline} · {', '.join(parts)}" if parts else headline


def _summarize_artists(result: ArtistSyncResult) -> str:
    artists = sum(kind.artists for kind in result.results)
    added = sum(kind.interests_created for kind in result.results)
    removed = sum(kind.interests_removed for kind in result.results)
    return _with_deltas(f"Imported {_plural(artists, 'artist')}", added, removed)


def _summarize_suggestions(result: SuggestionSyncResult) -> str:
    total = result.suggestions_created + result.suggestions_kept
    return _with_deltas(
        f"Suggested {_plural(total, 'artist')}",
        result.suggestions_created,
        result.suggestions_removed,
    )


def _summarize_events(result: EventSyncResult) -> str:
    return _with_deltas(
        f"Found {_plural(result.events_total, 'concert')}",
        result.events_created,
        result.events_removed,
    )


def _summarize_playlists(result: PlaylistSyncResult) -> str:
    synced = [playlist for playlist in result.playlists if playlist.status == "synced"]
    # Track counts span every status: an emptied no-city playlist removes
    # tracks too, and the summary must explain where they went.
    added = sum(playlist.tracks_added for playlist in result.playlists)
    removed = sum(playlist.tracks_removed for playlist in result.playlists)
    return _with_deltas(f"Generated {_plural(len(synced), 'playlist')}", added, removed, "track")


@dataclass(frozen=True)
class _StepSpec:
    key: SyncStepKey
    label: str
    step: str
    attempt_timeout: timedelta
    summarize: Callable[[Any], str]


STEP_SPECS = (
    _StepSpec(
        key="artists",
        label="Import listening history from Last.fm",
        step="sync_artists",
        attempt_timeout=timedelta(minutes=2),
        summarize=_summarize_artists,
    ),
    _StepSpec(
        key="suggestions",
        label="Suggest artists",
        step="sync_suggestions",
        attempt_timeout=timedelta(minutes=15),
        summarize=_summarize_suggestions,
    ),
    _StepSpec(
        key="events",
        label="Find concerts",
        step="sync_events",
        # A cold sync resolves and fetches every interest artist against two
        # sources, the RA one politely rate-limited to 1 request/second:
        # ~25 minutes for a 900-artist profile, and nothing is committed
        # until the step ends, so a timeout would restart it from scratch.
        attempt_timeout=timedelta(minutes=60),
        summarize=_summarize_events,
    ),
    _StepSpec(
        key="playlists",
        label="Generate Spotify playlists",
        step="sync_playlists",
        attempt_timeout=timedelta(minutes=30),
        summarize=_summarize_playlists,
    ),
)


def pending_steps() -> list[SyncStepProgress]:
    return [
        SyncStepProgress(key=spec.key, label=spec.label, status="pending") for spec in STEP_SPECS
    ]


def _backoff(attempt: int) -> float:
    return min(
        INITIAL_BACKOFF.total_seconds() * BACKOFF_COEFFICIENT ** (attempt - 1),
        MAX_BACKOFF.total_seconds(),
    )


def _retryable(exc: Exception) -> bool:
    return not isinstance(exc, SyncStepError) or exc.retryable


async def _with_retries[T](attempt: Callable[[], Awaitable[T]], attempt_timeout: timedelta) -> T:
    """Run `attempt` up to MAX_ATTEMPTS times with exponential backoff, each
    try bounded by `attempt_timeout` and the whole thing by that plus
    RETRY_MARGIN. Non-retryable step errors end it at once."""
    async with asyncio.timeout((attempt_timeout + RETRY_MARGIN).total_seconds()):
        for number in range(1, MAX_ATTEMPTS + 1):
            try:
                async with asyncio.timeout(attempt_timeout.total_seconds()):
                    return await attempt()
            except Exception as exc:
                if number == MAX_ATTEMPTS or not _retryable(exc):
                    raise
            await asyncio.sleep(_backoff(number))
    raise AssertionError("unreachable")


async def _save_progress(run: SyncRun, progress: list[SyncStepProgress]) -> None:
    async with session_factory() as session:
        await record_step_progress(session, run, progress)
        await session.commit()


async def _finish(
    run: SyncRun,
    progress: list[SyncStepProgress],
    status: SyncOutcome,
    error: BaseException | None = None,
) -> None:
    # A step error wraps the real cause; that is what an operator wants to see.
    detail = None
    if isinstance(error, SyncStepError) and error.__cause__ is not None:
        detail = repr(error.__cause__)
    elif error is not None:
        detail = repr(error)
    async with session_factory() as session:
        await finish_sync_run(session, run, progress, status, detail)
        await session.commit()


async def _heartbeat(run: SyncRun) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL.total_seconds())
        try:
            async with session_factory() as session:
                await heartbeat_sync_run(session, run)
                await session.commit()
        except SyncRunLost:
            raise
        except Exception:
            # Transient: the row only goes stale if this keeps failing for
            # STALE_AFTER, and then a reclaim is the right outcome anyway.
            logger.warning("Heartbeat for sync run %s failed", run.id, exc_info=True)


async def _fail(
    run: SyncRun,
    progress: list[SyncStepProgress],
    step: SyncStepProgress,
    summary: str,
    error: BaseException,
) -> SyncOutcome:
    # Later steps consume this one's writes, so stop here; the remaining
    # steps stay pending and the run fails.
    step.status = "failed"
    step.finished_at = datetime.now(UTC)
    step.summary = summary
    await _finish(run, progress, "failed", error)
    return "failed"


async def _execute(run: SyncRun, steps: SyncSteps, progress: list[SyncStepProgress]) -> SyncOutcome:
    for spec, step in zip(STEP_SPECS, progress, strict=True):
        if step.status == "completed":
            # Resumed after a reclaim or a requeue; the earlier work is committed.
            continue
        step.status = "running"
        await _save_progress(run, progress)
        try:
            result = await _with_retries(
                partial(getattr(steps, spec.step), run.user_id), spec.attempt_timeout
            )
            summary = spec.summarize(result)
        except TimeoutError as exc:
            logger.warning("Sync step %s timed out", spec.key)
            return await _fail(run, progress, step, STEP_UNFINISHED, exc)
        except SyncStepError as exc:
            return await _fail(run, progress, step, exc.message, exc)
        except Exception as exc:
            # A bug in the pipeline itself: fail the run rather than leaving a
            # row that would be reclaimed and crash the same way forever.
            logger.exception("Sync step %s crashed", spec.key)
            return await _fail(run, progress, step, STEP_UNFINISHED, exc)
        step.status = "completed"
        step.finished_at = datetime.now(UTC)
        step.summary = summary
        await _save_progress(run, progress)
    await _finish(run, progress, "completed")
    return "completed"


async def run_sync(run: SyncRun, steps: SyncSteps) -> SyncOutcome | None:
    """Execute a claimed run to completion, keeping its heartbeat fresh.
    Returns None when another worker took the run over; on cancellation
    (worker shutdown) the run is handed back to the queue."""
    progress = run_steps(run)
    outcome: SyncOutcome | None = None
    try:
        try:
            async with asyncio.TaskGroup() as group:
                beat = group.create_task(_heartbeat(run))
                try:
                    outcome = await _execute(run, steps, progress)
                finally:
                    beat.cancel()
        except* SyncRunLost:
            logger.warning("Sync run %s was reclaimed by another worker", run.id)
    except asyncio.CancelledError:
        with contextlib.suppress(Exception):
            async with session_factory() as session:
                await requeue_sync_run(session, run)
                await session.commit()
        raise
    return outcome


async def dispatch_nightly_syncs(steps: SyncSteps) -> None:
    """Sync every due user, one at a time, then run the playlist cleanup."""
    user_ids = await _with_retries(steps.list_users_due_for_sync, timedelta(minutes=1))
    synced = failed = skipped = 0
    for user_id in user_ids:
        async with session_factory() as session:
            run = await start_nightly_sync_run(session, user_id, pending_steps())
            await session.commit()
        if run is None:
            # A run is in flight for this user; it does the job.
            skipped += 1
            continue
        try:
            outcome = await run_sync(run, steps)
        except Exception:
            # One user's broken sync must not stall the rest of the fleet.
            logger.exception("Nightly sync for user %s crashed", user_id)
            outcome = "failed"
        if outcome == "completed":
            synced += 1
        elif outcome == "failed":
            failed += 1
    # Drain before audit so that we clean up even if the audit fails. Newly-audited
    # rows will get drained on the next run.
    drain = TombstoneDrainResult(drained=0, pending=0)
    try:
        drain = await _with_retries(steps.drain_playlist_tombstones, CLEANUP_TIMEOUT)
    except Exception:
        logger.exception("Tombstone drain failed; retrying next dispatch")
    orphans_found = 0
    try:
        orphans_found = await _with_retries(steps.audit_bot_playlists, CLEANUP_TIMEOUT)
    except Exception:
        logger.exception("Bot-account audit failed; retrying next dispatch")
    pruned = 0
    try:
        async with session_factory() as session:
            pruned = await prune_sync_runs(session)
            await session.commit()
    except Exception:
        logger.exception("Sync run pruning failed; retrying next dispatch")
    logger.info(
        "Nightly dispatch: %d synced, %d failed, %d skipped (already in flight); "
        "%d tombstones drained (%d pending); audit found %d orphaned playlists; "
        "%d old runs pruned",
        synced,
        failed,
        skipped,
        drain.drained,
        drain.pending,
        orphans_found,
        pruned,
    )
