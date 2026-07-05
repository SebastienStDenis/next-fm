import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.lastfm import LastfmClient, LastfmUserInfo, LastfmUserNotFoundError
from app.models import City, LastfmAccount, LastfmConnection, User
from app.schemas import CityRead, CitySet, LastfmAccountRead, LastfmLink, UserCreate, UserRead

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


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


@app.get("/cities", response_model=list[CityRead])
async def search_cities(
    q: Annotated[str, Query(min_length=2)],
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> list[City]:
    """Search cities by name, most populous first."""
    pattern = f"%{_escape_like(q.strip())}%"
    result = await session.execute(
        select(City)
        .where(
            or_(
                City.name.ilike(pattern, escape="\\"),
                City.ascii_name.ilike(pattern, escape="\\"),
            )
        )
        .order_by(City.population.desc(), City.geonameid)
        .limit(limit)
    )
    return list(result.scalars())


@app.get("/users/{user_id}/city", response_model=CityRead)
async def get_user_city(user_id: uuid.UUID, session: SessionDep) -> City:
    """Return the user's city; 404 if none is set."""
    user = await _require_user(session, user_id)
    city = await session.get(City, user.city_id) if user.city_id is not None else None
    if city is None:
        raise HTTPException(status_code=404, detail="No city set")
    return city


@app.put("/users/{user_id}/city", response_model=CityRead)
async def set_user_city(user_id: uuid.UUID, payload: CitySet, session: SessionDep) -> City:
    """Set the user's city, replacing any existing one."""
    user = await _require_user(session, user_id)
    city = await session.get(City, payload.geonameid)
    if city is None:
        raise HTTPException(status_code=404, detail="City not found")
    user.city_id = city.geonameid
    await session.commit()
    return city


@app.delete("/users/{user_id}/city", status_code=204)
async def clear_user_city(user_id: uuid.UUID, session: SessionDep) -> None:
    """Remove the user's city; 404 if none is set."""
    user = await _require_user(session, user_id)
    if user.city_id is None:
        raise HTTPException(status_code=404, detail="No city set")
    user.city_id = None
    await session.commit()


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
