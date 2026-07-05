import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.artist_sync import SYNC_KINDS, sync_lastfm_artists
from app.config import get_settings
from app.db import get_session
from app.lastfm import (
    LastfmClient,
    LastfmPrivateDataError,
    LastfmUserInfo,
    LastfmUserNotFoundError,
)
from app.models import Artist, LastfmAccount, LastfmConnection, User, UserArtistInterest
from app.schemas import (
    ArtistInterestRead,
    ArtistRead,
    ArtistSyncRequest,
    ArtistSyncResult,
    LastfmAccountRead,
    LastfmLink,
    UserArtistRead,
    UserCreate,
    UserRead,
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_lastfm_client() -> LastfmClient:
    api_key = get_settings().lastfm_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="LASTFM_API_KEY is not configured")
    return LastfmClient(api_key)


LastfmClientDep = Annotated[LastfmClient, Depends(get_lastfm_client)]

app = FastAPI(title="live-playlists API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health(session: SessionDep) -> dict[str, str]:
    """Check API and database connectivity."""
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/users", response_model=list[UserRead])
async def list_users(session: SessionDep) -> list[User]:
    """List all users."""
    result = await session.execute(select(User).order_by(User.id))
    return list(result.scalars())


@app.post("/users", response_model=UserRead, status_code=201)
async def create_user(payload: UserCreate, session: SessionDep) -> User:
    """Create a user."""
    user = User(name=payload.name)
    session.add(user)
    await session.commit()
    return user


@app.get("/users/{user_id}", response_model=UserRead)
async def get_user(user_id: uuid.UUID, session: SessionDep) -> User:
    """Fetch a single user."""
    return await _require_user(session, user_id)


@app.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: uuid.UUID, session: SessionDep) -> None:
    """Delete a user and their Last.fm link."""
    user = await _require_user(session, user_id)
    await session.delete(user)
    await session.commit()


async def _require_user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _linked_lastfm_account(session: AsyncSession, user_id: uuid.UUID) -> LastfmAccount | None:
    result = await session.execute(
        select(LastfmAccount)
        .join(LastfmConnection, LastfmConnection.lastfm_account_id == LastfmAccount.id)
        .where(LastfmConnection.user_id == user_id)
    )
    return result.scalar_one_or_none()


def _apply_user_info(account: LastfmAccount, info: LastfmUserInfo, synced_at: datetime) -> None:
    account.username = info.username
    account.real_name = info.real_name
    account.avatar_url = info.avatar_url
    account.profile_url = info.profile_url
    account.country = info.country
    account.registered_at = info.registered_at
    account.playcount = info.playcount
    account.artist_count = info.artist_count
    account.last_synced_at = synced_at


async def _fetch_user_info(lastfm: LastfmClient, username: str) -> LastfmUserInfo:
    try:
        return await lastfm.get_user_info(username)
    except LastfmUserNotFoundError:
        raise HTTPException(status_code=404, detail="Last.fm user not found") from None


@app.get("/users/{user_id}/lastfm", response_model=LastfmAccountRead)
async def get_linked_lastfm_account(user_id: uuid.UUID, session: SessionDep) -> LastfmAccount:
    """Return the user's linked Last.fm account; 404 if none is linked."""
    await _require_user(session, user_id)
    account = await _linked_lastfm_account(session, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")
    return account


@app.put("/users/{user_id}/lastfm", response_model=LastfmAccountRead)
async def link_lastfm_account(
    user_id: uuid.UUID,
    payload: LastfmLink,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> LastfmAccount:
    """Link the user to a Last.fm account by username, replacing any existing link."""
    await _require_user(session, user_id)
    info = await _fetch_user_info(lastfm, payload.username)

    result = await session.execute(
        select(LastfmAccount).where(func.lower(LastfmAccount.username) == info.username.lower())
    )
    account = result.scalar_one_or_none()
    if account is None:
        account = LastfmAccount()
        session.add(account)
    _apply_user_info(account, info, datetime.now(UTC))
    await session.flush()

    result = await session.execute(
        select(LastfmConnection).where(LastfmConnection.user_id == user_id)
    )
    connection = result.scalar_one_or_none()
    if connection is None:
        session.add(LastfmConnection(user_id=user_id, lastfm_account_id=account.id))
    else:
        connection.lastfm_account_id = account.id

    await session.commit()
    return account


@app.post("/users/{user_id}/lastfm/refresh", response_model=LastfmAccountRead)
async def refresh_lastfm_account(
    user_id: uuid.UUID,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> LastfmAccount:
    """Re-fetch the linked Last.fm account's details and update them."""
    await _require_user(session, user_id)
    account = await _linked_lastfm_account(session, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")

    info = await _fetch_user_info(lastfm, account.username)
    _apply_user_info(account, info, datetime.now(UTC))
    await session.commit()
    return account


@app.post("/users/{user_id}/lastfm/artists/sync", response_model=ArtistSyncResult)
async def sync_lastfm_artists_for_user(
    user_id: uuid.UUID,
    session: SessionDep,
    lastfm: LastfmClientDep,
    payload: ArtistSyncRequest | None = None,
) -> ArtistSyncResult:
    """Fetch the linked Last.fm account's taste signals and upsert artist interests.

    Body may narrow the sync to specific kinds; the default syncs all of them.
    """
    await _require_user(session, user_id)
    account = await _linked_lastfm_account(session, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")

    kinds = list(dict.fromkeys(payload.kinds)) if payload else list(SYNC_KINDS)
    try:
        results = await sync_lastfm_artists(session, lastfm, user_id, account.username, kinds)
    except LastfmUserNotFoundError:
        raise HTTPException(status_code=404, detail="Last.fm user not found") from None
    except LastfmPrivateDataError:
        raise HTTPException(
            status_code=403, detail="This Last.fm account's listening data is private"
        ) from None
    await session.commit()
    return ArtistSyncResult(synced_at=datetime.now(UTC), results=results)


@app.get("/users/{user_id}/artists", response_model=list[UserArtistRead])
async def list_user_artists(user_id: uuid.UUID, session: SessionDep) -> list[UserArtistRead]:
    """List the user's artists of interest, grouped by artist with all reasons."""
    await _require_user(session, user_id)
    result = await session.execute(
        select(UserArtistInterest, Artist)
        .join(Artist, UserArtistInterest.artist_id == Artist.id)
        .where(UserArtistInterest.user_id == user_id)
        .order_by(func.lower(Artist.name), UserArtistInterest.kind)
    )
    grouped: dict[uuid.UUID, UserArtistRead] = {}
    for interest, artist in result.all():
        entry = grouped.get(artist.id)
        if entry is None:
            entry = UserArtistRead(artist=ArtistRead.model_validate(artist), interests=[])
            grouped[artist.id] = entry
        entry.interests.append(ArtistInterestRead.model_validate(interest))
    return list(grouped.values())


@app.get("/artists", response_model=list[ArtistRead])
async def list_artists(session: SessionDep) -> list[Artist]:
    """List all canonical artists."""
    result = await session.execute(select(Artist).order_by(func.lower(Artist.name)))
    return list(result.scalars())


@app.delete("/users/{user_id}/lastfm", status_code=204)
async def unlink_lastfm_account(user_id: uuid.UUID, session: SessionDep) -> None:
    """Remove the user's Last.fm link; 404 if none is linked."""
    await _require_user(session, user_id)
    result = await session.execute(
        select(LastfmConnection).where(LastfmConnection.user_id == user_id)
    )
    connection = result.scalar_one_or_none()
    if connection is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")
    await session.delete(connection)
    await session.commit()
