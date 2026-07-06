import uuid
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.artist_sync import name_key
from app.lastfm import LastfmArtistNotFoundError, LastfmClient
from app.matching import EVENT_MATCH_RADIUS_KM, distance_km
from app.models import (
    Artist,
    ArtistTopTrack,
    City,
    Event,
    EventArtist,
    LastfmArtist,
    Playlist,
    PlaylistTrack,
    SpotifyArtist,
    User,
    UserArtistInterest,
)
from app.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.schemas import PlaylistSyncItem, PlaylistSyncResult
from app.spotify import SpotifyApiError, SpotifyArtistData, SpotifyClient, track_uri

CITY_SHOWS_KIND = "city_shows"
CITY_PLAYLIST_CAP = 3

MATCH_EXACT = "exact"
MATCH_FUZZY = "fuzzy"

TOP_TRACKS_TTL = timedelta(days=30)
TOP_TRACKS_PER_ARTIST = 5
TOP_TRACKS_FETCH_LIMIT = 10
PLAYLIST_MAX_TRACKS = 100
WRITE_BATCH_SIZE = 100


class ArtistMatch(BaseModel):
    """A playlist-relevant artist with their soonest matched show."""

    artist_id: uuid.UUID
    event_id: uuid.UUID
    starts_at: datetime


class DesiredTrack(BaseModel):
    spotify_track_id: str
    artist_id: uuid.UUID
    event_id: uuid.UUID


def playlist_title(user_name: str, city_name: str | None) -> str:
    if city_name is None:
        return f"{user_name}'s shows"
    return f"{user_name}'s shows in {city_name}"


def playlist_description(city_name: str, now: datetime) -> str:
    return f"Artists you love playing near {city_name}. Updated {now:%B %Y}."


async def sync_user_playlists(
    session: AsyncSession,
    spotify: SpotifyClient,
    lastfm: LastfmClient,
    musicbrainz: MusicBrainzClient,
    user: User,
) -> PlaylistSyncResult:
    """Reconcile all of the user's playlists against current local state.

    Inputs are refreshed first (Spotify resolution for newly matched artists,
    top-track cache past TTL), shared across playlists; then each playlist is
    diffed and delta-written. Event freshness is the event sync's job.
    """
    now = datetime.now(UTC)
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
        matches = await _match_artists(session, user.id, city)
        to_sync.append((playlist, city, matches))
        matched_ids |= {match.artist_id for match in matches}

    resolved = await _resolve_spotify_artists(session, spotify, musicbrainz, matched_ids)
    refreshed = await _refresh_top_tracks(session, spotify, lastfm, resolved)

    for playlist, city, matches in to_sync:
        items.append(await _sync_playlist(session, spotify, playlist, user, city, matches, now))

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
        default = Playlist(
            user_id=user.id,
            kind=CITY_SHOWS_KIND,
            city_id=None,
            name=playlist_title(user.name, city.name if city else None),
        )
        session.add(default)
        await session.flush()
        playlists.insert(0, default)
    return playlists


async def _target_city(session: AsyncSession, playlist: Playlist, user: User) -> City | None:
    city_id = playlist.city_id if playlist.city_id is not None else user.city_id
    if city_id is None:
        return None
    return await session.get(City, city_id)


async def _match_artists(
    session: AsyncSession, user_id: uuid.UUID, city: City
) -> list[ArtistMatch]:
    """The event-plan match join, reduced to one soonest show per artist,
    ordered soonest-first."""
    distance = distance_km(city.latitude, city.longitude)
    result = await session.execute(
        select(EventArtist.artist_id, Event.id, Event.starts_at)
        .join(Event, Event.id == EventArtist.event_id)
        .join(UserArtistInterest, UserArtistInterest.artist_id == EventArtist.artist_id)
        .where(
            UserArtistInterest.user_id == user_id,
            Event.starts_at > func.now(),
            distance <= EVENT_MATCH_RADIUS_KM,
        )
        .order_by(Event.starts_at, Event.id)
        .distinct()
    )
    matches: dict[uuid.UUID, ArtistMatch] = {}
    for artist_id, event_id, starts_at in result.all():
        matches.setdefault(
            artist_id, ArtistMatch(artist_id=artist_id, event_id=event_id, starts_at=starts_at)
        )
    return list(matches.values())


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
    search per track resolves it to something playable by the right artist."""
    now = datetime.now(UTC)
    refreshed = 0
    for row in resolved:
        if row.match_confidence == MATCH_FUZZY:
            continue
        if row.top_tracks_synced_at and now - row.top_tracks_synced_at < TOP_TRACKS_TTL:
            continue
        try:
            tracks = await _fetch_verified_tracks(spotify, lastfm, row)
        except SpotifyApiError:
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
    capped so every delta batch fits one 100-URI request."""
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


def plan_moves(current: list[str], desired_order: list[str]) -> list[tuple[int, int]]:
    """Reorder ops (range_start, insert_before) that sort `current` into the
    relative order given by `desired_order`, moving items instead of
    re-adding them so Spotify's per-item added_at survives."""
    order = {track_id: index for index, track_id in enumerate(desired_order)}
    target = sorted(current, key=lambda track_id: order[track_id])
    work = list(current)
    moves: list[tuple[int, int]] = []
    for position, wanted in enumerate(target):
        if work[position] == wanted:
            continue
        source = work.index(wanted, position + 1)
        moves.append((source, position))
        work.insert(position, work.pop(source))
    return moves


def plan_insertions(desired: list[str], surviving: set[str]) -> list[tuple[int, list[str]]]:
    """Contiguous runs of new tracks with their final insert positions,
    assuming survivors are already in desired relative order."""
    runs: list[tuple[int, list[str]]] = []
    run: list[str] = []
    run_start = 0
    for index, track_id in enumerate(desired):
        if track_id in surviving:
            if run:
                runs.append((run_start, run))
                run = []
            continue
        if not run:
            run_start = index
        run.append(track_id)
    if run:
        runs.append((run_start, run))
    return runs


async def _sync_playlist(
    session: AsyncSession,
    spotify: SpotifyClient,
    playlist: Playlist,
    user: User,
    city: City,
    matches: list[ArtistMatch],
    now: datetime,
) -> PlaylistSyncItem:
    top_tracks = await _top_tracks_by_artist(session, {match.artist_id for match in matches})
    desired = desired_tracks(matches, top_tracks)

    name = playlist_title(user.name, city.name)
    description = playlist_description(city.name, now)
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
    current_ids = [row.spotify_track_id for row in current_rows]

    if not created and playlist.snapshot_id:
        # The bot is the only writer of its own playlists, so playlist_tracks
        # is trusted as the remote image; the snapshot chain is the tripwire
        # on that assumption. On divergence, re-read and heal the diff base.
        remote_snapshot = await spotify.get_playlist_snapshot_id(spotify_playlist_id)
        if remote_snapshot != playlist.snapshot_id:
            current_ids = await spotify.get_playlist_track_ids(spotify_playlist_id)

    desired_ids = [track.spotify_track_id for track in desired]
    added, removed, moved = await _write_deltas(
        spotify, playlist, spotify_playlist_id, current_ids, desired_ids
    )

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
        tracks_added=added,
        tracks_removed=removed,
        tracks_moved=moved,
        tracks_total=len(desired),
    )


async def _write_deltas(
    spotify: SpotifyClient,
    playlist: Playlist,
    playlist_id: str,
    current_ids: list[str],
    desired_ids: list[str],
) -> tuple[int, int, int]:
    """Push the difference: removals, then survivor reorders, then additions
    at their final positions. Every write's snapshot_id lands on the playlist."""
    snapshot = playlist.snapshot_id

    desired_set = set(desired_ids)
    to_remove = sorted({track_id for track_id in current_ids if track_id not in desired_set})
    for batch in _batches(to_remove, WRITE_BATCH_SIZE):
        snapshot = (
            await spotify.remove_playlist_items(
                playlist_id, [track_uri(track_id) for track_id in batch]
            )
            or snapshot
        )

    survivors = [track_id for track_id in current_ids if track_id in desired_set]
    moves = plan_moves(survivors, desired_ids)
    for range_start, insert_before in moves:
        snapshot = (
            await spotify.reorder_playlist_items(playlist_id, range_start, insert_before)
            or snapshot
        )

    added = 0
    for position, run in plan_insertions(desired_ids, set(survivors)):
        for offset, batch in enumerate(_batches(run, WRITE_BATCH_SIZE)):
            snapshot = (
                await spotify.add_playlist_items(
                    playlist_id,
                    [track_uri(track_id) for track_id in batch],
                    position=position + offset * WRITE_BATCH_SIZE,
                )
                or snapshot
            )
            added += len(batch)

    playlist.snapshot_id = snapshot
    return added, len(to_remove), len(moves)


def _batches(items: list[str], size: int) -> list[list[str]]:
    return [items[start : start + size] for start in range(0, len(items), size)]
