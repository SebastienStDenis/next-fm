import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BeforeValidator
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from temporalio.client import (
    Client as TemporalClient,
)
from temporalio.client import (
    WorkflowExecutionStatus,
    WorkflowQueryFailedError,
)
from temporalio.common import WorkflowIDConflictPolicy
from temporalio.service import RPCError, RPCStatusCode

from app.accounts import linked_lastfm_account
from app.artist_sync import SYNC_KINDS, sync_lastfm_artists
from app.auth import CurrentUserDep, get_claims
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
from app.matching import EVENT_MATCH_RADIUS_KM, artist_qualifies, distance_km
from app.models import (
    Artist,
    ArtistTopTrack,
    BandsintownEvent,
    City,
    Event,
    EventArtist,
    LastfmAccount,
    LastfmConnection,
    Playlist,
    PlaylistTrack,
    User,
    UserArtistInterest,
)
from app.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.playlist_sync import (
    CITY_CONCERTS_KIND,
    PINNED_PLAYLIST_CAP,
    playlist_title,
    sync_user_playlists,
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
    PlaylistCreate,
    PlaylistRead,
    PlaylistSyncResult,
    PlaylistTrackRead,
    SuggestionSyncResult,
    SyncRunResult,
    SyncStartResult,
    SyncStatusResult,
    UserArtistRead,
    UserEventRead,
    UserRead,
    UserUpdate,
)
from app.spotify import SpotifyApiError, SpotifyAuthError, SpotifyClient
from app.suggestion_sync import sync_user_suggestions
from app.supabase_admin import SupabaseAdminClient, SupabaseAdminError
from app.sync_workflow import SyncUserWorkflow, pending_steps, user_sync_workflow_id
from app.temporal import connect_temporal

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


async def get_spotify_client() -> AsyncIterator[SpotifyClient]:
    settings = get_settings()
    missing = [
        key.upper()
        for key in ("spotify_client_id", "spotify_client_secret", "spotify_refresh_token")
        if not getattr(settings, key)
    ]
    if missing:
        raise HTTPException(status_code=503, detail=f"{', '.join(missing)} is not configured")
    client = SpotifyClient(
        settings.spotify_client_id,
        settings.spotify_client_secret,
        settings.spotify_refresh_token,
    )
    try:
        yield client
    finally:
        await client.aclose()


SpotifyClientDep = Annotated[SpotifyClient, Depends(get_spotify_client)]


async def get_musicbrainz_client() -> AsyncIterator[MusicBrainzClient]:
    client = MusicBrainzClient()
    try:
        yield client
    finally:
        await client.aclose()


MusicBrainzClientDep = Annotated[MusicBrainzClient, Depends(get_musicbrainz_client)]


async def get_supabase_admin() -> AsyncIterator[SupabaseAdminClient | None]:
    settings = get_settings()
    if not settings.supabase_secret_key:
        yield None
        return
    client = SupabaseAdminClient(settings.supabase_url, settings.supabase_secret_key)
    try:
        yield client
    finally:
        await client.aclose()


SupabaseAdminDep = Annotated[SupabaseAdminClient | None, Depends(get_supabase_admin)]

_temporal_client: TemporalClient | None = None


async def get_temporal_client() -> TemporalClient:
    # Connected lazily and kept for the process lifetime, so the API starts
    # (and every non-sync endpoint works) even while Temporal is unreachable.
    global _temporal_client
    if _temporal_client is None:
        try:
            _temporal_client = await connect_temporal(get_settings())
        except (RPCError, OSError, RuntimeError) as exc:
            raise HTTPException(status_code=503, detail=f"Temporal is unavailable: {exc}") from None
    return _temporal_client


TemporalClientDep = Annotated[TemporalClient, Depends(get_temporal_client)]

app = FastAPI(title="Next.fm API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins_list,
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


@app.exception_handler(SpotifyAuthError)
async def spotify_auth_error(request: Request, exc: SpotifyAuthError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(SpotifyApiError)
async def spotify_api_error(request: Request, exc: SpotifyApiError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(MusicBrainzApiError)
async def musicbrainz_api_error(request: Request, exc: MusicBrainzApiError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(SupabaseAdminError)
async def supabase_admin_error(request: Request, exc: SupabaseAdminError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.get("/health")
async def health(session: SessionDep) -> dict[str, str]:
    """Check API and database connectivity."""
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/me", response_model=UserRead)
async def get_me(user: CurrentUserDep) -> User:
    """Return the authenticated user, provisioning the row on first login."""
    return user


@app.patch("/me", response_model=UserRead)
async def update_me(user: CurrentUserDep, payload: UserUpdate, session: SessionDep) -> User:
    """Update the user's settings."""
    if payload.include_known_artists is not None:
        user.include_known_artists = payload.include_known_artists
    await session.commit()
    return user


@app.delete("/me", status_code=204)
async def delete_me(user: CurrentUserDep, session: SessionDep, admin: SupabaseAdminDep) -> None:
    """Delete the account: the Supabase auth user first (so a re-login can't
    re-provision it mid-delete), then the app row and everything cascading. The
    admin client - and thus SUPABASE_SECRET_KEY - is only required when the
    account is actually linked to a Supabase auth user."""
    if user.supabase_user_id is not None:
        if admin is None:
            raise HTTPException(status_code=503, detail="SUPABASE_SECRET_KEY is not configured")
        await admin.delete_user(user.supabase_user_id)
    await session.delete(user)
    await session.commit()


CITY_FUZZY_THRESHOLD = 0.45


@app.get(
    "/cities",
    response_model=list[CityRead],
    dependencies=[Depends(get_claims)],
)
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


@app.get("/me/city", response_model=CityRead)
async def get_user_city(user: CurrentUserDep, session: SessionDep) -> City:
    """Return the user's city; 404 if none is set."""
    city = await session.get(City, user.city_id) if user.city_id is not None else None
    if city is None:
        raise HTTPException(status_code=404, detail="No city set")
    return city


@app.put("/me/city", response_model=CityRead)
async def set_user_city(user: CurrentUserDep, payload: CitySet, session: SessionDep) -> City:
    """Set the user's city, replacing any existing one."""
    city = await session.get(City, payload.geonameid)
    if city is None:
        raise HTTPException(status_code=404, detail="City not found")
    user.city_id = city.geonameid
    await session.commit()
    return city


@app.delete("/me/city", status_code=204)
async def clear_user_city(user: CurrentUserDep, session: SessionDep) -> None:
    """Remove the user's city; 404 if none is set."""
    if user.city_id is None:
        raise HTTPException(status_code=404, detail="No city set")
    user.city_id = None
    await session.commit()


def _apply_user_info(account: LastfmAccount, info: LastfmUserInfo, synced_at: datetime) -> None:
    account.username = info.username
    account.real_name = info.real_name
    account.avatar_url = info.avatar_url
    account.profile_url = info.profile_url
    account.country = info.country
    account.registered_at = info.registered_at
    account.last_synced_at = synced_at


@app.get("/me/lastfm", response_model=LastfmAccountRead)
async def get_linked_lastfm_account(user: CurrentUserDep, session: SessionDep) -> LastfmAccount:
    """Return the user's linked Last.fm account; 404 if none is linked."""
    account = await linked_lastfm_account(session, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")
    return account


@app.put("/me/lastfm", response_model=LastfmAccountRead)
async def link_lastfm_account(
    user: CurrentUserDep,
    payload: LastfmLink,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> LastfmAccount:
    """Link the user to a Last.fm account by username, replacing any existing link."""
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
        select(LastfmConnection).where(LastfmConnection.user_id == user.id)
    )
    connection = result.scalar_one_or_none()
    if connection is None:
        session.add(LastfmConnection(user_id=user.id, lastfm_account_id=account.id))
    else:
        connection.lastfm_account_id = account.id

    await session.commit()
    return account


@app.post("/me/lastfm/refresh", response_model=LastfmAccountRead)
async def refresh_lastfm_account(
    user: CurrentUserDep,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> LastfmAccount:
    """Re-fetch the linked Last.fm account's details and update them."""
    account = await linked_lastfm_account(session, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")

    info = await lastfm.get_user_info(account.username)
    _apply_user_info(account, info, datetime.now(UTC))
    await session.commit()
    return account


@app.post("/me/lastfm/artists/sync", response_model=ArtistSyncResult)
async def sync_lastfm_artists_for_user(
    user: CurrentUserDep,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> ArtistSyncResult:
    """Fetch all of the linked Last.fm account's taste signals and upsert artist interests."""
    account = await linked_lastfm_account(session, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")

    results = await sync_lastfm_artists(session, lastfm, user.id, account.username, SYNC_KINDS)
    await session.commit()
    return ArtistSyncResult(synced_at=datetime.now(UTC), results=results)


@app.get("/me/artists", response_model=list[UserArtistRead])
async def list_user_artists(user: CurrentUserDep, session: SessionDep) -> list[UserArtistRead]:
    """List the user's artists of interest, grouped by artist with all reasons."""
    result = await session.execute(
        select(UserArtistInterest, Artist)
        .join(Artist, UserArtistInterest.artist_id == Artist.id)
        .where(UserArtistInterest.user_id == user.id)
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


@app.get(
    "/artists",
    response_model=list[ArtistRead],
    dependencies=[Depends(get_claims)],
)
async def list_artists(session: SessionDep) -> list[Artist]:
    """List all canonical artists."""
    result = await session.execute(select(Artist).order_by(func.lower(Artist.name)))
    return list(result.scalars())


@app.post("/me/suggestions/sync", response_model=SuggestionSyncResult)
async def sync_suggestions_for_user(
    user: CurrentUserDep,
    session: SessionDep,
    lastfm: LastfmClientDep,
) -> SuggestionSyncResult:
    """Recompute the user's suggested artists from their taste (similar-artist
    edges, scoring, thresholds) and reconcile their suggestion interests."""
    account = await linked_lastfm_account(session, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")

    result = await sync_user_suggestions(session, lastfm, user, account.username)
    await session.commit()
    return result


@app.post("/me/events/sync", response_model=EventSyncResult)
async def sync_events_for_user(
    user: CurrentUserDep,
    session: SessionDep,
    bandsintown: BandsintownClientDep,
) -> EventSyncResult:
    """Refresh upcoming events for the user's interest artists (freshness-gated per artist)."""
    result = await sync_user_events(session, bandsintown, user.id)
    await session.commit()
    return result


@app.get("/me/events", response_model=list[UserEventRead])
async def list_user_events(
    user: CurrentUserDep,
    session: SessionDep,
    radius_km: Annotated[float, Query(gt=0, le=500)] = EVENT_MATCH_RADIUS_KM,
    geonameid: int | None = None,
    include_known_artists: bool | None = None,
) -> list[UserEventRead]:
    """List upcoming events by the user's servable artists near the given
    city (defaulting to the user's own). include_known_artists overrides the
    user's setting, letting the UI show everything."""
    if geonameid is not None:
        city = await session.get(City, geonameid)
        if city is None:
            raise HTTPException(status_code=404, detail="City not found")
    else:
        city = await session.get(City, user.city_id) if user.city_id is not None else None
        if city is None:
            raise HTTPException(status_code=409, detail="Set a city to match events")

    if include_known_artists is None:
        include_known_artists = user.include_known_artists
    distance = distance_km(city.latitude, city.longitude).label("distance_km")
    result = await session.execute(
        select(Event, Artist, BandsintownEvent.url, distance)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .join(Artist, Artist.id == EventArtist.artist_id)
        .outerjoin(BandsintownEvent, BandsintownEvent.event_id == Event.id)
        .where(
            artist_qualifies(user.id, EventArtist.artist_id, include_known_artists),
            Event.starts_at > func.now(),
            distance <= radius_km,
        )
        .order_by(Event.starts_at, Event.id)
    )
    grouped: dict[uuid.UUID, UserEventRead] = {}
    for event, artist, url, km in result.all():
        entry = grouped.get(event.id)
        if entry is None:
            entry = UserEventRead(
                event=EventRead.model_validate(event),
                url=url,
                distance_km=round(km, 1),
                artists=[],
            )
            grouped[event.id] = entry
        entry.artists.append(ArtistRead.model_validate(artist))
    return list(grouped.values())


async def _require_playlist(
    session: AsyncSession, user_id: uuid.UUID, playlist_id: uuid.UUID
) -> Playlist:
    playlist = await session.get(Playlist, playlist_id)
    if playlist is None or playlist.user_id != user_id:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@app.get("/me/playlists", response_model=list[PlaylistRead])
async def list_user_playlists(user: CurrentUserDep, session: SessionDep) -> list[PlaylistRead]:
    """List the user's playlists with tracks and provenance (artist + concert per track)."""
    result = await session.execute(
        select(Playlist, City)
        .outerjoin(City, City.geonameid == Playlist.city_id)
        .where(Playlist.user_id == user.id)
        .order_by(Playlist.id)
    )
    playlists = {
        playlist.id: PlaylistRead(
            id=playlist.id,
            kind=playlist.kind,
            name=playlist.name,
            description=playlist.description,
            city=CityRead.model_validate(city) if city else None,
            spotify_playlist_id=playlist.spotify_playlist_id,
            spotify_url=playlist.spotify_url,
            last_synced_at=playlist.last_synced_at,
            tracks=[],
        )
        for playlist, city in result.all()
    }
    if playlists:
        result = await session.execute(
            select(PlaylistTrack, Artist, Event, ArtistTopTrack.title, BandsintownEvent.url)
            .outerjoin(Artist, Artist.id == PlaylistTrack.artist_id)
            .outerjoin(Event, Event.id == PlaylistTrack.event_id)
            .outerjoin(
                ArtistTopTrack,
                (ArtistTopTrack.artist_id == PlaylistTrack.artist_id)
                & (ArtistTopTrack.spotify_track_id == PlaylistTrack.spotify_track_id),
            )
            .outerjoin(BandsintownEvent, BandsintownEvent.event_id == PlaylistTrack.event_id)
            .where(PlaylistTrack.playlist_id.in_(playlists.keys()))
            .order_by(PlaylistTrack.playlist_id, PlaylistTrack.position)
        )
        for track, artist, event, title, url in result.all():
            playlists[track.playlist_id].tracks.append(
                PlaylistTrackRead(
                    position=track.position,
                    spotify_track_id=track.spotify_track_id,
                    title=title,
                    artist=ArtistRead.model_validate(artist) if artist else None,
                    event=EventRead.model_validate(event) if event else None,
                    url=url,
                )
            )
    return list(playlists.values())


@app.post("/me/playlists", response_model=PlaylistRead, status_code=201)
async def create_pinned_playlist(
    user: CurrentUserDep, payload: PlaylistCreate, session: SessionDep
) -> PlaylistRead:
    """Pin a playlist to a city, independent of where the user lives."""
    city = await session.get(City, payload.geonameid)
    if city is None:
        raise HTTPException(status_code=404, detail="City not found")

    result = await session.execute(
        select(Playlist).where(
            Playlist.user_id == user.id,
            Playlist.kind == CITY_CONCERTS_KIND,
            Playlist.city_id.is_not(None),
        )
    )
    pinned = list(result.scalars())
    if any(playlist.city_id == city.geonameid for playlist in pinned):
        raise HTTPException(status_code=409, detail="A playlist for this city already exists")
    if len(pinned) >= PINNED_PLAYLIST_CAP:
        raise HTTPException(
            status_code=409, detail=f"At most {PINNED_PLAYLIST_CAP} pinned playlists per user"
        )

    playlist = Playlist(
        user_id=user.id,
        kind=CITY_CONCERTS_KIND,
        city_id=city.geonameid,
        name=playlist_title(user.name, city.name),
    )
    session.add(playlist)
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent create for the same city won the unique constraint.
        raise HTTPException(
            status_code=409, detail="A playlist for this city already exists"
        ) from None
    return PlaylistRead(
        id=playlist.id,
        kind=playlist.kind,
        name=playlist.name,
        description=playlist.description,
        city=CityRead.model_validate(city),
        spotify_playlist_id=None,
        spotify_url=None,
        last_synced_at=None,
        tracks=[],
    )


@app.post("/me/playlists/sync", response_model=PlaylistSyncResult)
async def sync_playlists_for_user(
    user: CurrentUserDep,
    session: SessionDep,
    spotify: SpotifyClientDep,
    lastfm: LastfmClientDep,
    musicbrainz: MusicBrainzClientDep,
) -> PlaylistSyncResult:
    """Reconcile all of the user's playlists on Spotify against their current
    matched concerts, refreshing artist resolutions and top-track caches as needed."""
    result = await sync_user_playlists(session, spotify, lastfm, musicbrainz, user)
    await session.commit()
    return result


@app.delete("/me/playlists/{playlist_id}", status_code=204)
async def delete_playlist(
    user: CurrentUserDep,
    playlist_id: uuid.UUID,
    session: SessionDep,
    spotify: SpotifyClientDep,
) -> None:
    """Unfollow the playlist on Spotify (its only notion of delete), then drop it locally."""
    playlist = await _require_playlist(session, user.id, playlist_id)
    if playlist.spotify_playlist_id is not None:
        try:
            await spotify.unfollow_playlist(playlist.spotify_playlist_id)
        except SpotifyApiError as exc:
            if exc.status_code != 404:
                raise
    await session.delete(playlist)
    await session.commit()


@app.delete("/me/lastfm", status_code=204)
async def unlink_lastfm_account(user: CurrentUserDep, session: SessionDep) -> None:
    """Remove the user's Last.fm link; 404 if none is linked."""
    result = await session.execute(
        select(LastfmConnection).where(LastfmConnection.user_id == user.id)
    )
    connection = result.scalar_one_or_none()
    if connection is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")
    await session.delete(connection)
    await session.commit()


@app.post("/me/sync", response_model=SyncStartResult, status_code=202)
async def start_user_sync(
    user: CurrentUserDep,
    session: SessionDep,
    temporal: TemporalClientDep,
) -> SyncStartResult:
    """Run the full sync pipeline (artists, suggestions, events, playlists)
    as a durable workflow; attaches to the running one if a sync is already
    in flight."""
    account = await linked_lastfm_account(session, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No Last.fm account linked")
    if user.city_id is None:
        raise HTTPException(status_code=404, detail="No home city set")

    try:
        handle = await temporal.start_workflow(
            SyncUserWorkflow.run,
            str(user.id),
            id=user_sync_workflow_id(user.id),
            task_queue=get_settings().temporal_task_queue,
            id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
        )
    except RPCError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    return SyncStartResult(workflow_id=handle.id)


_SYNC_STATUS_BY_EXECUTION: dict[
    WorkflowExecutionStatus | None, Literal["running", "completed", "failed"]
] = {
    WorkflowExecutionStatus.RUNNING: "running",
    WorkflowExecutionStatus.CONTINUED_AS_NEW: "running",
    WorkflowExecutionStatus.COMPLETED: "completed",
}


@app.get("/me/sync", response_model=SyncStatusResult)
async def get_user_sync_status(
    user: CurrentUserDep,
    temporal: TemporalClientDep,
) -> SyncStatusResult:
    """Report the user's current (or most recent retained) sync run with
    per-step progress; status "none" if no run exists."""
    handle = temporal.get_workflow_handle(user_sync_workflow_id(user.id), result_type=SyncRunResult)
    try:
        description = await handle.describe(rpc_timeout=timedelta(seconds=5))
    except RPCError as exc:
        if exc.status == RPCStatusCode.NOT_FOUND:
            return SyncStatusResult(status="none", steps=pending_steps())
        raise HTTPException(status_code=502, detail=str(exc)) from None

    status = _SYNC_STATUS_BY_EXECUTION.get(description.status, "failed")
    if status == "completed":
        # A closed run answers queries only by replaying its history on a
        # worker; the run result carries the same steps and is read straight
        # from the server.
        try:
            steps = (await handle.result(rpc_timeout=timedelta(seconds=5))).steps
        except RPCError:
            steps = pending_steps()
    else:
        try:
            steps = await handle.query(SyncUserWorkflow.progress, rpc_timeout=timedelta(seconds=5))
        except RPCError, WorkflowQueryFailedError:
            # Progress is best-effort: the run's history may have aged out or
            # no worker may be available to answer; the overall status still
            # stands.
            steps = pending_steps()
    return SyncStatusResult(
        status=status,
        started_at=description.start_time,
        finished_at=description.close_time,
        steps=steps,
    )
