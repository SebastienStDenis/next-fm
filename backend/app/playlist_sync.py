import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.artist_sync import name_key
from app.lastfm import LastfmApiError, LastfmArtistNotFoundError, LastfmClient
from app.matching import ArtistMatch, match_artist_concerts
from app.models import (
    Artist,
    ArtistTopTrack,
    City,
    LastfmArtist,
    Playlist,
    PlaylistTrack,
    SpotifyArtist,
    SpotifyPlaylistTombstone,
    User,
)
from app.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.schemas import PlaylistSyncItem, PlaylistSyncResult, TombstoneDrainResult
from app.spotify import (
    SpotifyApiError,
    SpotifyArtistData,
    SpotifyAuthError,
    SpotifyClient,
    track_uri,
)

logger = logging.getLogger(__name__)

CITY_CONCERTS_KIND = "city_concerts"
PINNED_PLAYLIST_CAP = 4  # pinned cities per user; the home-city playlist is always kept

MATCH_EXACT = "exact"
MATCH_FUZZY = "fuzzy"

TOP_TRACKS_TTL = timedelta(days=30)
TOP_TRACKS_PER_ARTIST = 3  # breadth over depth: ~33 artists' concerts fit the cap
TOP_TRACKS_FETCH_LIMIT = 10
FETCH_CONCURRENCY = 4  # conservative: dev-mode rate limits are unpublished and low
PLAYLIST_MAX_TRACKS = 100  # one 100-URI replace request per sync

TOMBSTONE_SOURCE_DELETE = "delete"
TOMBSTONE_SOURCE_AUDIT = "audit"
# Audit tombstones age this long before the drainer acts, so an id created by
# an in-flight sync (committed seconds after the audit listed it) is never
# unfollowed; the drainer re-checks it is still unclaimed at drain time too.
AUDIT_CONFIRMATION_AGE = timedelta(hours=24)


class DesiredTrack(BaseModel):
    spotify_track_id: str
    artist_id: uuid.UUID
    event_id: uuid.UUID


def playlist_title(user_name: str, city_name: str | None) -> str:
    possessive = f"{user_name}'" if user_name.endswith(("s", "S")) else f"{user_name}'s"
    if city_name is None:
        return f"{possessive} concerts"
    return f"{possessive} concerts in {city_name}"


def playlist_description(city_name: str, now: datetime) -> str:
    return f"Artists you might like playing near {city_name}. Updated {now:%B %Y}."


async def settle_tombstone(
    session: AsyncSession, spotify: SpotifyClient, spotify_playlist_id: str
) -> bool:
    """Unfollow one remote playlist and drop its tombstone, best effort: any
    Spotify failure returns False and leaves the tombstone for the nightly
    drainer. A 404/400 means the playlist is already gone - settled. The
    caller owns the commit."""
    try:
        await spotify.unfollow_playlist(spotify_playlist_id)
    except SpotifyApiError as exc:
        if exc.status_code not in (400, 404):
            logger.warning(
                "Unfollow of playlist %s failed, tombstone kept: %s", spotify_playlist_id, exc
            )
            return False
        if exc.status_code == 400:
            # Tombstoned ids came from Spotify itself, so a malformed-id
            # rejection is an anomaly worth a trace even though we settle it.
            logger.warning(
                "Unfollow of playlist %s rejected with 400; treating as gone", spotify_playlist_id
            )
    except (SpotifyAuthError, httpx.HTTPError) as exc:
        logger.warning(
            "Unfollow of playlist %s failed, tombstone kept: %s", spotify_playlist_id, exc
        )
        return False
    await session.execute(
        delete(SpotifyPlaylistTombstone).where(
            SpotifyPlaylistTombstone.spotify_playlist_id == spotify_playlist_id
        )
    )
    return True


async def _discard_remote_playlist(
    session: AsyncSession, spotify: SpotifyClient, spotify_playlist_id: str
) -> None:
    """Unfollow a remote playlist no row claims (a lost create race):
    tombstone it first, then settle - if the unfollow fails, the tombstone
    stays for the drainer, the same policy every other path follows."""
    await session.execute(
        pg_insert(SpotifyPlaylistTombstone)
        .values(spotify_playlist_id=spotify_playlist_id, source=TOMBSTONE_SOURCE_DELETE)
        .on_conflict_do_nothing()
    )
    await settle_tombstone(session, spotify, spotify_playlist_id)


async def drain_playlist_tombstones(
    session: AsyncSession, spotify: SpotifyClient
) -> TombstoneDrainResult:
    """Retry every pending unfollow. Delete tombstones drain unconditionally;
    audit tombstones only after AUDIT_CONFIRMATION_AGE, and only if no
    playlists row has claimed the id since the audit recorded it (a claimed
    id was an in-flight creation, not an orphan). The caller owns the commit."""
    now = datetime.now(UTC)
    result = await session.execute(select(SpotifyPlaylistTombstone))
    tombstones = list(result.scalars())
    drained = 0
    for tombstone in tombstones:
        if tombstone.source == TOMBSTONE_SOURCE_AUDIT:
            if now - tombstone.created_at < AUDIT_CONFIRMATION_AGE:
                continue
            claimed = await session.execute(
                select(Playlist.id).where(
                    Playlist.spotify_playlist_id == tombstone.spotify_playlist_id
                )
            )
            if claimed.scalar_one_or_none() is not None:
                await session.delete(tombstone)
                drained += 1
                continue
        if await settle_tombstone(session, spotify, tombstone.spotify_playlist_id):
            drained += 1
    return TombstoneDrainResult(drained=drained, pending=len(tombstones) - drained)


async def audit_bot_playlists(session: AsyncSession, spotify: SpotifyClient) -> int:
    """The safety net for remote playlists no committed row ever referenced
    (a crash between the Spotify create and the claim landing): list the bot
    account's playlists and record every unknown id as an audit tombstone.
    The drainer unfollows them after the confirmation age. Finding anything
    here means a bug elsewhere, hence the loud log. The caller owns the
    commit."""
    remote_ids = await spotify.list_own_playlist_ids()
    if not remote_ids:
        return 0
    result = await session.execute(
        select(Playlist.spotify_playlist_id).where(Playlist.spotify_playlist_id.is_not(None))
    )
    known = set(result.scalars())
    result = await session.execute(select(SpotifyPlaylistTombstone.spotify_playlist_id))
    known |= set(result.scalars())
    unknown = [remote_id for remote_id in remote_ids if remote_id not in known]
    for remote_id in unknown:
        await session.execute(
            pg_insert(SpotifyPlaylistTombstone)
            .values(spotify_playlist_id=remote_id, source=TOMBSTONE_SOURCE_AUDIT)
            .on_conflict_do_nothing()
        )
    if unknown:
        logger.warning(
            "Bot-account audit found %d orphaned playlist(s) on Spotify: %s",
            len(unknown),
            ", ".join(unknown),
        )
    return len(unknown)


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
            items.append(await _empty_playlist(session, spotify, playlist, now))
            continue
        matches = await match_artist_concerts(session, user.id, city, include_known_artists)
        to_sync.append((playlist, city, matches))
        matched_ids |= {match.artist_id for match in matches}

    resolved = await _resolve_spotify_artists(session, spotify, musicbrainz, matched_ids)
    refreshed = await _refresh_top_tracks(session, spotify, lastfm, resolved)
    # Bank the resolution and top-track work: it is global cache data, valid
    # on its own, and a cold run can represent many minutes of throttled API
    # calls that a later failure must not roll back.
    await session.commit()

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
    (kind city_concerts, city_id null) if it doesn't exist yet."""
    result = await session.execute(
        select(Playlist).where(Playlist.user_id == user.id).order_by(Playlist.id)
    )
    playlists = list(result.scalars())
    if not any(p.kind == CITY_CONCERTS_KIND and p.city_id is None for p in playlists):
        city = await session.get(City, user.city_id) if user.city_id is not None else None
        # Insert-then-select so a concurrent sync creating the same default
        # row is adopted instead of raising on the unique constraint.
        await session.execute(
            pg_insert(Playlist)
            .values(
                user_id=user.id,
                kind=CITY_CONCERTS_KIND,
                city_id=None,
                name=playlist_title(user.name, city.name if city else None),
            )
            .on_conflict_do_nothing()
        )
        result = await session.execute(
            select(Playlist).where(
                Playlist.user_id == user.id,
                Playlist.kind == CITY_CONCERTS_KIND,
                Playlist.city_id.is_(None),
            )
        )
        playlists.insert(0, result.scalar_one())
    return playlists


async def _empty_playlist(
    session: AsyncSession, spotify: SpotifyClient, playlist: Playlist, now: datetime
) -> PlaylistSyncItem:
    """A playlist with no target city reconciles to the empty tracklist: the
    remote playlist stays (it is the user's durable home-city surface) but
    must not keep advertising concerts near a city the user told us to
    forget. Setting a city again refills it on the next sync."""
    result = await session.execute(
        select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id)
    )
    current = list(result.scalars())
    if playlist.spotify_playlist_id is not None and current:
        try:
            snapshot = await spotify.replace_playlist_items(playlist.spotify_playlist_id, [])
            playlist.snapshot_id = snapshot or playlist.snapshot_id
        except SpotifyApiError as exc:
            # A vanished remote playlist has nothing left to empty; anything
            # else is transient and must fail the sync so it retries.
            if exc.status_code != 404:
                raise
        playlist.last_synced_at = now
    if current:
        await session.execute(delete(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist.id))
    return PlaylistSyncItem(
        playlist_id=playlist.id,
        name=playlist.name,
        status="no_city",
        tracks_removed=len(current),
    )


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
    """Soonest concert first, then track rank; URIs deduped (first artist wins);
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
) -> PlaylistSyncItem:
    top_tracks = await _top_tracks_by_artist(session, {match.artist_id for match in matches})
    desired = desired_tracks(matches, top_tracks)

    name = playlist_title(user.name, city.name)
    description = playlist_description(city.name, now)
    created = False
    spotify_playlist_id = playlist.spotify_playlist_id
    if spotify_playlist_id is None:
        data = await spotify.create_playlist(name, description)
        # Claim, don't assign: a concurrent sync may have attached its own
        # remote playlist to this row, or the row may have been deleted
        # mid-sync. Losing the claim means our creation is unwanted - the
        # loser unfollows it instead of orphaning it (or the winner's).
        result = await session.execute(
            update(Playlist)
            .where(Playlist.id == playlist.id, Playlist.spotify_playlist_id.is_(None))
            .values(
                spotify_playlist_id=data.id,
                spotify_url=data.url,
                snapshot_id=data.snapshot_id,
                name=name,
                description=description,
            )
            .returning(Playlist.id)
        )
        claimed = result.scalar_one_or_none() is not None
        # Commit the remote id immediately: losing it to a later failure would
        # make the next sync create a second playlist, orphaning this one on
        # the bot account.
        await session.commit()
        if claimed:
            spotify_playlist_id = data.id
            created = True
        else:
            await _discard_remote_playlist(session, spotify, data.id)
            await session.commit()
            result = await session.execute(
                select(Playlist)
                .where(Playlist.id == playlist.id)
                .execution_options(populate_existing=True)
            )
            survivor = result.scalar_one_or_none()
            if survivor is None or survivor.spotify_playlist_id is None:
                return PlaylistSyncItem(playlist_id=playlist.id, name=name, status="deleted")
            # Adopt the concurrent sync's remote playlist; re-writing it with
            # the same desired state is idempotent.
            playlist = survivor
            spotify_playlist_id = survivor.spotify_playlist_id
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

    # One full replace per changed tracklist: atomic, and surviving tracks
    # keep their added_at (verified, app.spotify_verify), so "Date added"
    # still reads as "newly announced concerts first". An unchanged tracklist
    # skips the write: the stored rows mirror the last committed replace, so
    # equality means the remote matches too, short of out-of-band divergence
    # (bot-account edits, a replace whose commit rolled back) that the next
    # real tracklist change overwrites.
    current_track_ids = [row.spotify_track_id for row in current_rows]
    desired_track_ids = [track.spotify_track_id for track in desired]
    if current_track_ids != desired_track_ids:
        snapshot = await spotify.replace_playlist_items(
            spotify_playlist_id, [track_uri(track_id) for track_id in desired_track_ids]
        )
        playlist.snapshot_id = snapshot or playlist.snapshot_id

    current_ids = set(current_track_ids)
    desired_ids = set(desired_track_ids)
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
