from fastapi import APIRouter, HTTPException

from app.core.accounts import linked_lastfm_account
from app.core.auth import CurrentUserDep
from app.core.deps import SessionDep
from app.core.schemas import SyncStartResult, SyncStatusResult
from app.sync.sync_pipeline import pending_steps
from app.sync.sync_runs import enqueue_sync_run, latest_sync_run, sync_status_from_run

router = APIRouter()


@router.post("/me/sync", response_model=SyncStartResult, status_code=202)
async def start_user_sync(user: CurrentUserDep, session: SessionDep) -> SyncStartResult:
    """Queue the full sync pipeline (artists, suggestions, events, playlists)
    for the worker; attaches to the run already queued or in flight if there
    is one."""
    account = await linked_lastfm_account(session, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")
    if user.city_id is None:
        raise HTTPException(status_code=404, detail="No home city set")

    run = await enqueue_sync_run(session, user.id, "manual", pending_steps())
    await session.commit()
    return SyncStartResult(run_id=run.id)


@router.get("/me/sync", response_model=SyncStatusResult)
async def get_user_sync_status(user: CurrentUserDep, session: SessionDep) -> SyncStatusResult:
    """Report the user's current (or most recent retained) sync run with
    per-step progress; status "none" if no run exists."""
    run = await latest_sync_run(session, user.id)
    if run is None:
        return SyncStatusResult(status="none", steps=pending_steps())
    return sync_status_from_run(run)
