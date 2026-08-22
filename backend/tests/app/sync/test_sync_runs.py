import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from app.core.models import SyncRun
from app.sync.sync_runs import SyncRunLost, requeue_sync_run


def make_run() -> SyncRun:
    return SyncRun(
        id=uuid.uuid7(),
        user_id=uuid.uuid7(),
        trigger="manual",
        status="running",
        steps=[],
        claim_id=uuid.uuid4(),
        created_at=datetime.now(UTC),
    )


async def test_requeue_only_updates_a_running_claim() -> None:
    session = AsyncMock()
    result = MagicMock(rowcount=1)
    session.execute.return_value = result
    run = make_run()

    await requeue_sync_run(session, run)

    statement = session.execute.await_args.args[0]
    sql = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "sync_runs.status = 'running'" in sql
    assert f"sync_runs.claim_id = '{run.claim_id}'" in sql


async def test_requeue_loses_its_claim_after_run_finishes() -> None:
    session = AsyncMock()
    result = MagicMock(rowcount=0)
    session.execute.return_value = result
    run = make_run()

    with pytest.raises(SyncRunLost):
        await requeue_sync_run(session, run)
