import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BeforeValidator
from sqlalchemy import ColumnElement, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.artist_sync import SYNC_KINDS, sync_lastfm_artists
from app.bandsintown import BandsintownApiError, BandsintownClient
from app.config import get_settings
from app.db import get_session
from app.event_sync import sync_user_events
from app.lastfm import (
    LastfmApiError,
    LastfmClient,
    LastfmPrivateDataError,
    LastfmUserInfo,
    LastfmUserNotFoundError,
)
from app.models import (
    Artist,
    BandsintownEvent,
    City,
    Event,
    EventArtist,
    LastfmAccount,
    LastfmConnection,
    User,
    UserArtistInterest,
)
from app.schemas import (
    ArtistInterestRead,
    ArtistRead,
    ArtistSyncResult,
    CityRead,
    CitySet,
    EventRead,
    EventSyncResult,
    LastfmAccountRead,
    LastfmLink,
    UserArtistRead,
    UserCreate,
    UserEventRead,
    UserRead,
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_lastfm_client() -> AsyncIterator[LastfmClient]:
    api_key = get_settings().lastfm_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="LASTFM_API_KEY is not configured")
    client = LastfmClient(api_key)
    try:
        yield client
    finally:
        await client.aclose()


LastfmClientDep = Annotated[LastfmClient, Depends(get_lastfm_client)]


async def get_bandsintown_client() -> AsyncIterator[BandsintownClient]:
    app_id = get_settings().bandsintown_api_key
    if not app_id:
        raise HTTPException(status_code=503, detail="BANDSINTOWN_API_KEY is not configured")
    client = BandsintownClient(app_id)
    try:
        yield client
    finally:
        await client.aclose()


BandsintownClientDep = Annotated[BandsintownClient, Depends(get_bandsintown_client)]

app = FastAPI(title="live-playlists API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(LastfmUserNotFoundError)
async def lastfm_user_not_found(request: Request, exc: LastfmUserNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Last.fm user not found"})


@app.exception_handler(LastfmPrivateDataError)
async def lastfm_private_data(request: Request, exc: LastfmPrivateDataError) -> JSONResponse:
    return JSONResponse(
        status_code=403, content={"detail": "This Last.fm account's listening data is private"}
    )


@app.exception_handler(LastfmApiError)
async def lastfm_api_error(request: Request, exc: LastfmApiError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(BandsintownApiError)
async def bandsintown_api_error(request: Request, exc: BandsintownApiError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


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


CITY_FUZZY_THRESHOLD = 0.45


@app.get("/cities", response_model=list[CityRead])
async def search_cities(
    q: Annotated[str, BeforeValidator(str.strip), Query(min_length=2)],
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> list[City]:
    """Search cities by name: substring and fuzzy matches, best first."""
    similarity = func.greatest(
        func.word_similarity(q, City.name),
        func.word_similarity(q, City.ascii_name),
    )
    result = await session.execute(
        select(City)
        .where(
            or_(
                City.name.icontains(q, autoescape=True),
                City.ascii_name.icontains(q, autoescape=True),
                func.word_similarity(q, City.name) >= CITY_FUZZY_THRESHOLD,
                func.word_similarity(q, City.ascii_name) >= CITY_FUZZY_THRESHOLD,
            )
        )
        .order_by(
            City.ascii_name.istartswith(q, autoescape=True).desc(),
            # bucket similarity so population breaks near-ties instead of
            # a marginally closer trigram match beating a major city
            func.floor(similarity * 10).desc(),
            City.population.desc(),
            City.geonameid,
        )
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
    info = await lastfm.get_user_info(payload.username)

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

    info = await lastfm.get_user_info(account.username)
    _apply_user_info(account, info, datetime.now(UTC))
    await session.commit()
    return account


@app.post("/users/{user_id}/lastfm/artists/sync", response_model=ArtistSyncResult)
async def sync_lastfm_artists_for_user(
    user_id: uuid.UUID,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> ArtistSyncResult:
    """Fetch all of the linked Last.fm account's taste signals and upsert artist interests."""
    await _require_user(session, user_id)
    account = await _linked_lastfm_account(session, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")

    results = await sync_lastfm_artists(session, lastfm, user_id, account.username, SYNC_KINDS)
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


EVENT_MATCH_RADIUS_KM = 50.0


def _distance_km(latitude: float, longitude: float) -> ColumnElement[float]:
    """Haversine distance in km from the given point to Event's venue."""
    lat1, lon1 = func.radians(latitude), func.radians(longitude)
    lat2, lon2 = func.radians(Event.venue_latitude), func.radians(Event.venue_longitude)
    central_angle = 2 * func.asin(
        func.sqrt(
            func.power(func.sin((lat2 - lat1) / 2), 2)
            + func.cos(lat1) * func.cos(lat2) * func.power(func.sin((lon2 - lon1) / 2), 2)
        )
    )
    return 6371.0 * central_angle


@app.post("/users/{user_id}/events/sync", response_model=EventSyncResult)
async def sync_events_for_user(
    user_id: uuid.UUID,
    session: SessionDep,
    bandsintown: BandsintownClientDep,
) -> EventSyncResult:
    """Refresh upcoming events for the user's interest artists (freshness-gated per artist)."""
    await _require_user(session, user_id)
    result = await sync_user_events(session, bandsintown, user_id)
    await session.commit()
    return result


@app.get("/users/{user_id}/events", response_model=list[UserEventRead])
async def list_user_events(
    user_id: uuid.UUID,
    session: SessionDep,
    radius_km: Annotated[float, Query(gt=0, le=500)] = EVENT_MATCH_RADIUS_KM,
) -> list[UserEventRead]:
    """List upcoming events near the user's city by artists they have an interest in."""
    user = await _require_user(session, user_id)
    city = await session.get(City, user.city_id) if user.city_id is not None else None
    if city is None:
        raise HTTPException(status_code=409, detail="Set a city to match events")

    distance = _distance_km(city.latitude, city.longitude).label("distance_km")
    result = await session.execute(
        select(Event, Artist, BandsintownEvent.url, distance)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .join(Artist, Artist.id == EventArtist.artist_id)
        .join(UserArtistInterest, UserArtistInterest.artist_id == Artist.id)
        .outerjoin(BandsintownEvent, BandsintownEvent.event_id == Event.id)
        .where(
            UserArtistInterest.user_id == user_id,
            Event.starts_at > func.now(),
            distance <= radius_km,
        )
        .order_by(Event.starts_at, Event.id)
        .distinct()
    )
    grouped: dict[uuid.UUID, UserEventRead] = {}
    for event, artist, url, distance_km in result.all():
        entry = grouped.get(event.id)
        if entry is None:
            entry = UserEventRead(
                event=EventRead.model_validate(event),
                url=url,
                distance_km=round(distance_km, 1),
                artists=[],
            )
            grouped[event.id] = entry
        entry.artists.append(ArtistRead.model_validate(artist))
    return list(grouped.values())


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
