import logging
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUserDep
from app.core.deps import OptionalSpotifyClientDep, SessionDep
from app.core.models import (
    Artist,
    ArtistTopTrack,
    City,
    Event,
    Playlist,
    PlaylistTrack,
)
from app.core.schemas import (
    ArtistRead,
    CityRead,
    EventRead,
    PlaylistCreate,
    PlaylistRead,
    PlaylistTrackRead,
)
from app.sync.matching import ticket_url
from app.sync.playlist_sync import (
    CITY_CONCERTS_KIND,
    PINNED_PLAYLIST_CAP,
    playlist_title,
    settle_tombstone,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _require_playlist(
    session: AsyncSession, user_id: uuid.UUID, playlist_id: uuid.UUID
) -> Playlist:
    playlist = await session.get(Playlist, playlist_id)
    if playlist is None or playlist.user_id != user_id:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.get("/me/playlists", response_model=list[PlaylistRead])
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
            select(
                PlaylistTrack,
                Artist,
                Event,
                ArtistTopTrack.title,
                ticket_url(PlaylistTrack.event_id),
            )
            .outerjoin(Artist, Artist.id == PlaylistTrack.artist_id)
            .outerjoin(Event, Event.id == PlaylistTrack.event_id)
            .outerjoin(
                ArtistTopTrack,
                (ArtistTopTrack.artist_id == PlaylistTrack.artist_id)
                & (ArtistTopTrack.spotify_track_id == PlaylistTrack.spotify_track_id),
            )
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


@router.post("/me/playlists", response_model=PlaylistRead, status_code=201)
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
        raise HTTPException(status_code=409, detail="Pinned city limit reached")

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


@router.delete("/me/playlists/{playlist_id}", status_code=204)
async def delete_playlist(
    user: CurrentUserDep,
    playlist_id: uuid.UUID,
    session: SessionDep,
    spotify: OptionalSpotifyClientDep,
) -> None:
    """Drop the playlist locally (the playlists trigger tombstones its Spotify
    id in the same transaction), then delete from Spotify best-effort."""
    playlist = await _require_playlist(session, user.id, playlist_id)
    remote_id = playlist.spotify_playlist_id
    await session.delete(playlist)
    await session.commit()
    if remote_id is not None and spotify is not None:
        try:
            if await settle_tombstone(session, spotify, remote_id):
                await session.commit()
        except Exception:
            logger.exception("Post-delete playlist cleanup failed; tombstone remains")
