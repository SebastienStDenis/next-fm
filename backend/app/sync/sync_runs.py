"""The `sync_runs` queue: how runs are enqueued, claimed, and written back.

The API enqueues manual runs and reads the latest one for status; the worker
claims runs, records progress while executing them, and marks them finished.
A run row is owned by whoever holds its `claim_id`: every write from a worker
is fenced on it, so a run reclaimed after a stale heartbeat has exactly one
writer at any time. None of these functions commit; callers own the
transaction. See docs/design/2026-08-16-postgres-sync-queue-plan.md.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal, cast

from sqlalchemy import CursorResult, and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.models import SyncRun, User
from app.core.schemas import SyncStatusResult, SyncStepProgress

SyncRunTrigger = Literal["manual", "nightly"]

# A running run whose heartbeat is older than this was abandoned by its
# worker (crash, kill) and may be claimed again. Generous on purpose: recovery
# latency matters far less than never executing a live step twice.
STALE_AFTER = timedelta(minutes=5)

# Finished runs older than this are pruned by the nightly dispatch, except
# each user's latest, which the status endpoint keeps serving.
RETENTION = timedelta(days=30)

_STATUS_BY_RUN_STATUS: dict[str, Literal["running", "completed", "failed"]] = {
    "queued": "running",
    "running": "running",
    "completed": "completed",
    "failed": "failed",
}


class SyncRunLost(Exception):
    """Another worker reclaimed the run; this one must stop touching it."""


def _steps_json(steps: list[SyncStepProgress]) -> list[dict]:
    return [step.model_dump(mode="json") for step in steps]


def run_steps(run: SyncRun) -> list[SyncStepProgress]:
    return [SyncStepProgress.model_validate(step) for step in run.steps]


def sync_status_from_run(run: SyncRun) -> SyncStatusResult:
    # From the user's point of view the run began when it was enqueued; a
    # queued run is one that is running but hasn't been picked up yet.
    return SyncStatusResult(
        status=_STATUS_BY_RUN_STATUS[run.status],
        started_at=run.created_at,
        finished_at=run.finished_at,
        steps=run_steps(run),
    )


async def _active_run(session: AsyncSession, user_id: uuid.UUID) -> SyncRun | None:
    result = await session.execute(
        select(SyncRun).where(SyncRun.user_id == user_id, SyncRun.status.in_(("queued", "running")))
    )
    return result.scalar_one_or_none()


async def _insert_run(session: AsyncSession, **values: object) -> SyncRun | None:
    """Insert unless the user already has an active run (the partial unique
    index), in which case return None."""
    result = await session.execute(
        pg_insert(SyncRun).values(**values).on_conflict_do_nothing().returning(SyncRun)
    )
    return result.scalar_one_or_none()


async def enqueue_sync_run(
    session: AsyncSession,
    user_id: uuid.UUID,
    trigger: SyncRunTrigger,
    steps: list[SyncStepProgress],
) -> SyncRun:
    """Queue a run for the user, or return the one already active."""
    while True:
        run = await _insert_run(
            session, user_id=user_id, trigger=trigger, status="queued", steps=_steps_json(steps)
        )
        if run is not None:
            return run
        # The active run may finish between the conflict and this lookup;
        # then the insert simply goes through on the next pass.
        active = await _active_run(session, user_id)
        if active is not None:
            return active


async def start_nightly_sync_run(
    session: AsyncSession, user_id: uuid.UUID, steps: list[SyncStepProgress]
) -> SyncRun | None:
    """Create a nightly run already claimed by the caller, or None when the
    user has a run in flight (which does the job)."""
    now = datetime.now(UTC)
    return await _insert_run(
        session,
        user_id=user_id,
        trigger="nightly",
        status="running",
        steps=_steps_json(steps),
        claim_id=uuid.uuid4(),
        started_at=now,
        heartbeat_at=now,
    )


async def claim_sync_run(session: AsyncSession) -> SyncRun | None:
    """Take the oldest queued run - or a running one whose worker went quiet -
    for this worker. `SKIP LOCKED` keeps concurrent claimers apart."""
    stale = and_(SyncRun.status == "running", SyncRun.heartbeat_at < func.now() - STALE_AFTER)
    result = await session.execute(
        select(SyncRun)
        .where(or_(SyncRun.status == "queued", stale))
        .order_by(SyncRun.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    run = result.scalar_one_or_none()
    if run is None:
        return None
    now = datetime.now(UTC)
    run.status = "running"
    run.claim_id = uuid.uuid4()
    run.heartbeat_at = now
    if run.started_at is None:
        run.started_at = now
    return run


async def latest_sync_run(session: AsyncSession, user_id: uuid.UUID) -> SyncRun | None:
    result = await session.execute(
        select(SyncRun)
        .where(SyncRun.user_id == user_id)
        .order_by(SyncRun.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _fenced_update(session: AsyncSession, run: SyncRun, **values: object) -> None:
    result = await session.execute(
        update(SyncRun)
        .where(
            SyncRun.id == run.id,
            SyncRun.status == "running",
            SyncRun.claim_id == run.claim_id,
        )
        .values(**values)
    )
    if cast(CursorResult, result).rowcount != 1:
        raise SyncRunLost(run.id)


async def heartbeat_sync_run(session: AsyncSession, run: SyncRun) -> None:
    await _fenced_update(session, run, heartbeat_at=func.now())


async def record_step_progress(
    session: AsyncSession, run: SyncRun, steps: list[SyncStepProgress]
) -> None:
    await _fenced_update(session, run, steps=_steps_json(steps))


async def finish_sync_run(
    session: AsyncSession,
    run: SyncRun,
    steps: list[SyncStepProgress],
    status: Literal["completed", "failed"],
    error: str | None = None,
) -> None:
    """Close the run; a completed run also stamps the user's `last_synced_at`
    in the same transaction, so the dashboard gate and the run agree."""
    now = datetime.now(UTC)
    await _fenced_update(
        session, run, status=status, steps=_steps_json(steps), error=error, finished_at=now
    )
    if status == "completed":
        await session.execute(
            update(User)
            .where(User.id == run.user_id)
            .values(
                last_synced_at=now,
                onboarding_completed=and_(
                    User.onboarding_completed,
                    User.last_synced_at.is_not(None),
                ),
            )
        )


async def requeue_sync_run(session: AsyncSession, run: SyncRun) -> None:
    """Hand a run back on graceful shutdown so the next worker resumes it
    right away instead of after the stale window."""
    await _fenced_update(session, run, status="queued", claim_id=None, heartbeat_at=None)


async def prune_sync_runs(session: AsyncSession) -> int:
    """Delete finished runs past retention that a newer run has superseded."""
    newer = aliased(SyncRun)
    superseded = (
        select(newer.id)
        .where(newer.user_id == SyncRun.user_id, newer.created_at > SyncRun.created_at)
        .correlate(SyncRun)
        .exists()
    )
    result = await session.execute(
        delete(SyncRun).where(
            SyncRun.status.in_(("completed", "failed")),
            SyncRun.finished_at < datetime.now(UTC) - RETENTION,
            superseded,
        )
    )
    return cast(CursorResult, result).rowcount
