import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.artist_sync import name_key
from app.lastfm import LastfmApiError, LastfmArtistNotFoundError, LastfmClient
from app.matching import ArtistMatch, match_artist_shows
from app.models import (
    Artist,
    ArtistTopTrack,
    City,
    LastfmArtist,
    Playlist,
    PlaylistTrack,
    SpotifyArtist,
    User,
)
from app.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.schemas import PlaylistSyncItem, PlaylistSyncResult
from app.spotify import SpotifyApiError, SpotifyArtistData, SpotifyClient, track_uri

CITY_SHOWS_KIND = "city_shows"
PINNED_PLAYLIST_CAP = 2  # pinned cities per user; the home-city playlist is always kept

MATCH_EXACT = "exact"
MATCH_FUZZY = "fuzzy"

TOP_TRACKS_TTL = timedelta(days=30)
TOP_TRACKS_PER_ARTIST = 3  # breadth over depth: ~33 artists' shows fit the cap
TOP_TRACKS_FETCH_LIMIT = 10
FETCH_CONCURRENCY = 4  # conservative: dev-mode rate limits are unpublished and low
PLAYLIST_MAX_TRACKS = 100  # one 100-URI replace request per sync


class DesiredTrack(BaseModel):
    spotify_track_id: str
    artist_id: uuid.UUID
    event_id: uuid.UUID


def playlist_title(user_name: str, city_name: str | None) -> str:
    if city_name is None:
        return f"{user_name}'s shows"
    return f"{user_name}'s shows in {city_name}"


def playlist_description(city_name: str, now: datetime, include_known_artists: bool) -> str:
    if include_known_artists:
        return f"Artists you love playing near {city_name}. Updated {now:%B %Y}."
    return f"New artists you might like playing near {city_name}. Updated {now:%B %Y}."


async def sync_user_playlists(
    session: AsyncSession,
    spotify: SpotifyClient,
    lastfm: LastfmClient,
    musicbrainz: MusicBrainzClient,
    user: User,
) -> PlaylistSyncResult:
    """Reconcile all of the user's playlists against current local state.

    Inputs are refreshed first (Spotify resolution for newly matched artists,
    top-track cache past TTL), shared across playlists; then each playlist's
    desired tracklist is written as one full replace. Event freshness is the
    event sync's job.
    """
    now = datetime.now(UTC)
    # One policy snapshot for the whole run: a toggle committed mid-sync must
    # not make the tracklist and the description disagree.
    include_known_artists = user.include_known_artists
    playlists = await _ensure_default_playlist(session, user)

    items: list[PlaylistSyncItem] = []
    to_sync: list[tuple[Playlist, City, list[ArtistMatch]]] = []
    matched_ids: set[uuid.UUID] = set()
    for playlist in playlists:
        city = await _target_city(session, playlist, user)
        if city is None:
            items.append(
                PlaylistSyncItem(playlist_id=playlist.id, name=playlist.name, status="no_city")
            )
            continue
        matches = await match_artist_shows(session, user.id, city, include_known_artists)
        to_sync.append((playlist, city, matches))
        matched_ids |= {match.artist_id for match in matches}

    resolved = await _resolve_spotify_artists(session, spotify, musicbrainz, matched_ids)
    refreshed = await _refresh_top_tracks(session, spotify, lastfm, resolved)
    # Bank the resolution and top-track work: it is global cache data, valid
    # on its own, and a cold run can represent many minutes of throttled API
    # calls that a later failure must not roll back.
    await session.commit()

    for playlist, city, matches in to_sync:
        items.append(
            await _sync_playlist(
                session, spotify, playlist, user, city, matches, now, include_known_artists
            )
        )

    contributing = sum(1 for row in resolved if row.match_confidence != MATCH_FUZZY)
    return PlaylistSyncResult(
        synced_at=now,
        artists_matched=len(matched_ids),
        artists_resolved=contributing,
        artists_unresolved=len(matched_ids) - contributing,
        top_tracks_refreshed=refreshed,
        playlists=items,
    )


async def _ensure_default_playlist(session: AsyncSession, user: User) -> list[Playlist]:
    """All of the user's playlists, creating the follow-the-user default row
    (kind city_shows, city_id null) if it doesn't exist yet."""
    result = await session.execute(
        select(Playlist).where(Playlist.user_id == user.id).order_by(Playlist.id)
    )
    playlists = list(result.scalars())
    if not any(p.kind == CITY_SHOWS_KIND and p.city_id is None for p in playlists):
        city = await session.get(City, user.city_id) if user.city_id is not None else None
        # Insert-then-select so a concurrent sync creating the same default
        # row is adopted instead of raising on the unique constraint.
        await session.execute(
            pg_insert(Playlist)
            .values(
                user_id=user.id,
                kind=CITY_SHOWS_KIND,
                city_id=None,
                name=playlist_title(user.name, city.name if city else None),
            )
            .on_conflict_do_nothing()
        )
        result = await session.execute(
            select(Playlist).where(
                Playlist.user_id == user.id,
                Playlist.kind == CITY_SHOWS_KIND,
                Playlist.city_id.is_(None),
            )
        )
        playlists.insert(0, result.scalar_one())
    return playlists


async def _target_city(session: AsyncSession, playlist: Playlist, user: User) -> City | None:
    city_id = playlist.city_id if playlist.city_id is not None else user.city_id
    if city_id is None:
        return None
    return await session.get(City, city_id)


async def _resolve_spotify_artists(
    session: AsyncSession,
    spotify: SpotifyClient,
    musicbrainz: MusicBrainzClient,
    artist_ids: set[uuid.UUID],
) -> list[SpotifyArtist]:
    """Ensure each matched artist has a Spotify identity claim, returning all
    known rows. Artists that resolve to nothing are retried on the next sync."""
    if not artist_ids:
        return []
    result = await session.execute(
        select(SpotifyArtist).where(SpotifyArtist.artist_id.in_(artist_ids))
    )
    rows = {row.artist_id: row for row in result.scalars()}

    unresolved_ids = artist_ids - rows.keys()
    if unresolved_ids:
        result = await session.execute(select(Artist).where(Artist.id.in_(unresolved_ids)))
        artists = list(result.scalars())
        result = await session.execute(
            select(LastfmArtist).where(LastfmArtist.artist_id.in_(unresolved_ids))
        )
        lastfm_rows = {row.artist_id: row for row in result.scalars()}
        for artist in artists:
            row = await _resolve_artist(
                session, spotify, musicbrainz, artist, lastfm_rows.get(artist.id)
            )
            if row is not None:
                rows[artist.id] = row
    return list(rows.values())


async def _resolve_artist(
    session: AsyncSession,
    spotify: SpotifyClient,
    musicbrainz: MusicBrainzClient,
    artist: Artist,
    lastfm_row: LastfmArtist | None,
) -> SpotifyArtist | None:
    lookup_name = lastfm_row.name if lastfm_row else artist.name

    resolved = None
    if lastfm_row and lastfm_row.mbid:
        resolved = await _resolve_via_musicbrainz(spotify, musicbrainz, lastfm_row.mbid)
    if resolved is None:
        results = await spotify.search_artists(lookup_name)
        if not results:
            return None
        exact = next(
            (item for item in results if name_key(item.name) == name_key(lookup_name)), None
        )
        resolved = (exact, MATCH_EXACT) if exact else (results[0], MATCH_FUZZY)

    data, confidence = resolved
    # Insert-then-select so a concurrent sync (or another canonical artist
    # already claiming this spotify_id) wins instead of aborting the flush.
    result = await session.execute(
        pg_insert(SpotifyArtist)
        .values(
            artist_id=artist.id,
            spotify_id=data.id,
            name=data.name,
            match_confidence=confidence,
        )
        .on_conflict_do_nothing()
        .returning(SpotifyArtist.id)
    )
    if result.scalar_one_or_none() is None:
        return None
    result = await session.execute(
        select(SpotifyArtist).where(SpotifyArtist.artist_id == artist.id)
    )
    return result.scalar_one_or_none()


async def _resolve_via_musicbrainz(
    spotify: SpotifyClient, musicbrainz: MusicBrainzClient, mbid: str
) -> tuple[SpotifyArtistData, str] | None:
    """Deterministic MBID -> Spotify link, used opportunistically: any failure
    falls back to the search path."""
    try:
        spotify_id = await musicbrainz.get_artist_spotify_id(mbid)
        if spotify_id is None:
            return None
        return await spotify.get_artist(spotify_id), MATCH_EXACT
    except MusicBrainzApiError, SpotifyApiError, httpx.HTTPError:
        return None


async def _refresh_top_tracks(
    session: AsyncSession,
    spotify: SpotifyClient,
    lastfm: LastfmClient,
    resolved: list[SpotifyArtist],
) -> int:
    """Re-fetch stale top-track caches: Last.fm decides the top N, one Spotify
    search per track resolves it to something playable by the right artist.
    Fetches run concurrently across artists; all session writes stay on this
    task."""
    now = datetime.now(UTC)
    stale = [
        row
        for row in resolved
        if row.match_confidence != MATCH_FUZZY
        and not (row.top_tracks_synced_at and now - row.top_tracks_synced_at < TOP_TRACKS_TTL)
    ]
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    outcomes = await asyncio.gather(
        *(_fetch_verified_tracks(spotify, lastfm, row, semaphore) for row in stale)
    )

    refreshed = 0
    for row, tracks in zip(stale, outcomes, strict=True):
        if tracks is None:
            # Leave top_tracks_synced_at untouched so the next sync retries.
            continue
        await session.execute(
            delete(ArtistTopTrack).where(ArtistTopTrack.artist_id == row.artist_id)
        )
        for fallback_rank, (lastfm_track, track_id) in enumerate(tracks, start=1):
            session.add(
                ArtistTopTrack(
                    artist_id=row.artist_id,
                    rank=lastfm_track.rank or fallback_rank,
                    title=lastfm_track.title,
                    spotify_track_id=track_id,
                )
            )
        row.top_tracks_synced_at = now
        refreshed += 1
    return refreshed


async def _fetch_verified_tracks(
    spotify: SpotifyClient, lastfm: LastfmClient, row: SpotifyArtist, semaphore: asyncio.Semaphore
) -> list[tuple] | None:
    """This artist's playable top tracks; None means a transient failure that
    should not stamp the freshness timestamp. An artist unknown to Last.fm is
    a durable empty result, not a failure."""
    async with semaphore:
        try:
            return await _fetch_verified_tracks_inner(spotify, lastfm, row)
        except SpotifyApiError, LastfmApiError, httpx.HTTPError:
            return None


async def _fetch_verified_tracks_inner(
    spotify: SpotifyClient, lastfm: LastfmClient, row: SpotifyArtist
) -> list[tuple]:
    try:
        candidates = await lastfm.get_artist_top_tracks(row.name, limit=TOP_TRACKS_FETCH_LIMIT)
    except LastfmArtistNotFoundError:
        return []
    tracks: list[tuple] = []
    seen: set[str] = set()
    for lastfm_track in candidates:
        if len(tracks) >= TOP_TRACKS_PER_ARTIST:
            break
        results = await spotify.search_tracks(lastfm_track.title, row.name)
        # Verifying the artist id is what makes name collisions safe;
        # unmatched tracks are simply absent (rank gaps are fine).
        match = next(
            (
                result
                for result in results
                if any(artist.id == row.spotify_id for artist in result.artists)
            ),
            None,
        )
        if match is None or match.id in seen:
            continue
        seen.add(match.id)
        tracks.append((lastfm_track, match.id))
    return tracks


async def _top_tracks_by_artist(
    session: AsyncSession, artist_ids: set[uuid.UUID]
) -> dict[uuid.UUID, list[ArtistTopTrack]]:
    if not artist_ids:
        return {}
    result = await session.execute(
        select(ArtistTopTrack)
        .where(ArtistTopTrack.artist_id.in_(artist_ids))
        .order_by(ArtistTopTrack.artist_id, ArtistTopTrack.rank, ArtistTopTrack.id)
    )
    grouped: dict[uuid.UUID, list[ArtistTopTrack]] = {}
    for track in result.scalars():
        grouped.setdefault(track.artist_id, []).append(track)
    return grouped


def desired_tracks(
    matches: list[ArtistMatch],
    top_tracks: dict[uuid.UUID, list[ArtistTopTrack]],
) -> list[DesiredTrack]:
    """Soonest show first, then track rank; URIs deduped (first artist wins);
    capped so the tracklist always fits one 100-URI replace request."""
    desired: list[DesiredTrack] = []
    seen: set[str] = set()
    for match in matches:
        for track in top_tracks.get(match.artist_id, [])[:TOP_TRACKS_PER_ARTIST]:
            if track.spotify_track_id in seen:
                continue
            seen.add(track.spotify_track_id)
            desired.append(
                DesiredTrack(
                    spotify_track_id=track.spotify_track_id,
                    artist_id=match.artist_id,
                    event_id=match.event_id,
                )
            )
    return desired[:PLAYLIST_MAX_TRACKS]


async def _sync_playlist(
    session: AsyncSession,
    spotify: SpotifyClient,
    playlist: Playlist,
    user: User,
    city: City,
    matches: list[ArtistMatch],
    now: datetime,
    include_known_artists: bool,
) -> PlaylistSyncItem:
    top_tracks = await _top_tracks_by_artist(session, {match.artist_id for match in matches})
    desired = desired_tracks(matches, top_tracks)

    name = playlist_title(user.name, city.name)
    description = playlist_description(city.name, now, include_known_artists)
    created = False
    spotify_playlist_id = playlist.spotify_playlist_id
    if spotify_playlist_id is None:
        data = await spotify.create_playlist(name, description)
        spotify_playlist_id = data.id
        playlist.spotify_playlist_id = data.id
        playlist.spotify_url = data.url
        playlist.snapshot_id = data.snapshot_id
        playlist.name = name
        playlist.description = description
        created = True
        # Commit the remote id immediately: losing it to a later failure would
        # make the next sync create a second playlist, orphaning this one on
        # the bot account.
        await session.commit()
    elif (playlist.name, playlist.description) != (name, description):
        await spotify.update_playlist_details(spotify_playlist_id, name, description)
        playlist.name = name
        playlist.description = description

    result = await session.execute(
        select(PlaylistTrack)
        .where(PlaylistTrack.playlist_id == playlist.id)
        .order_by(PlaylistTrack.position)
    )
    current_rows = list(result.scalars())

    # One replace per sync: atomic, idempotent, and self-healing against any
    # manual edits on the Spotify side. Surviving tracks keep their added_at
    # (verified, app.spotify_verify), so "Date added" still reads as "newly
    # announced shows first". Skipped only when a just-created playlist has
    # nothing to write.
    if not (created and not desired):
        snapshot = await spotify.replace_playlist_items(
            spotify_playlist_id, [track_uri(track.spotify_track_id) for track in desired]
        )
        playlist.snapshot_id = snapshot or playlist.snapshot_id

    current_ids = {row.spotify_track_id for row in current_rows}
    desired_ids = {track.spotify_track_id for track in desired}
    current_state = [(row.spotify_track_id, row.artist_id, row.event_id) for row in current_rows]
    desired_state = [(track.spotify_track_id, track.artist_id, track.event_id) for track in desired]
    if current_state != desired_state:
        await session.execute(delete(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id))
        for position, track in enumerate(desired):
            session.add(
                PlaylistTrack(
                    playlist_id=playlist.id,
                    position=position,
                    spotify_track_id=track.spotify_track_id,
                    artist_id=track.artist_id,
                    event_id=track.event_id,
                )
            )
    playlist.last_synced_at = now

    return PlaylistSyncItem(
        playlist_id=playlist.id,
        name=playlist.name,
        status="synced",
        created_remotely=created,
        tracks_added=len(desired_ids - current_ids),
        tracks_removed=len(current_ids - desired_ids),
        tracks_total=len(desired),
    )
