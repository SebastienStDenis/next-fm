import uuid
from collections.abc import Sequence

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.lastfm import LastfmClient, LastfmLovedTrack, LastfmTopArtist
from app.models import Artist, LastfmArtist, Source, UserArtistInterest
from app.schemas import ArtistSyncKindResult

TOP_ARTIST_KIND = "lastfm_top_artist"
LOVED_TRACKS_KIND = "lastfm_loved_tracks"
SYNC_KINDS = (TOP_ARTIST_KIND, LOVED_TRACKS_KIND)

LASTFM_TOP_ARTISTS_PERIOD = "12month"
LASTFM_TOP_ARTISTS_LIMIT = 200
LASTFM_LOVED_TRACKS_PAGE_SIZE = 200
LASTFM_LOVED_TRACKS_MAX_PAGES = 10


class ArtistSignal(BaseModel):
    """One artist-level taste signal extracted from a Last.fm response."""

    name: str
    url: str | None
    mbid: str | None
    evidence: dict
    weight: float | None = None


def name_key(name: str) -> str:
    """Canonical dedup key for artist names; the single case-folding authority
    (lastfm_artists.name_key is unique, so Postgres must never fold names itself)."""
    return name.casefold()


async def sync_lastfm_artists(
    session: AsyncSession,
    lastfm: LastfmClient,
    user_id: uuid.UUID,
    username: str,
    kinds: Sequence[str],
) -> list[ArtistSyncKindResult]:
    """Fetch taste signals from Last.fm and upsert artists and interests.

    Each kind is synced as a replacement of that (user, kind) scope: interests
    for artists no longer present in the fetched data are deleted, but only
    when the fetch was complete (a truncated fetch says nothing about what the
    user stopped liking).
    """
    results = []
    for kind in kinds:
        signals, complete = await _fetch_signals(lastfm, username, kind)
        artist_ids = await upsert_lastfm_artists(session, signals)
        signal_by_artist = {artist_ids[name_key(signal.name)]: signal for signal in signals}
        results.append(
            await sync_interests(
                session, user_id, kind, signal_by_artist, source=Source.LASTFM, prune=complete
            )
        )
    return results


async def _fetch_signals(
    lastfm: LastfmClient, username: str, kind: str
) -> tuple[list[ArtistSignal], bool]:
    if kind == TOP_ARTIST_KIND:
        top_artists = await lastfm.get_top_artists(
            username, period=LASTFM_TOP_ARTISTS_PERIOD, limit=LASTFM_TOP_ARTISTS_LIMIT
        )
        return top_artist_signals(top_artists), True
    if kind == LOVED_TRACKS_KIND:
        tracks: list[LastfmLovedTrack] = []
        page = 1
        complete = True
        while page <= LASTFM_LOVED_TRACKS_MAX_PAGES:
            result = await lastfm.get_loved_tracks(
                username, limit=LASTFM_LOVED_TRACKS_PAGE_SIZE, page=page
            )
            tracks.extend(result.tracks)
            complete = result.total_pages <= LASTFM_LOVED_TRACKS_MAX_PAGES
            if page >= result.total_pages:
                break
            page += 1
        return loved_track_signals(tracks), complete
    raise ValueError(f"Unknown sync kind: {kind}")


def top_artist_signals(top_artists: list[LastfmTopArtist]) -> list[ArtistSignal]:
    signals: dict[str, ArtistSignal] = {}
    for artist in top_artists:
        signals.setdefault(
            name_key(artist.name),
            ArtistSignal(
                name=artist.name,
                url=artist.url,
                mbid=artist.mbid,
                evidence={
                    "rank": artist.rank,
                    "playcount": artist.playcount,
                    "period": LASTFM_TOP_ARTISTS_PERIOD,
                },
                weight=float(artist.playcount) if artist.playcount is not None else None,
            ),
        )
    return list(signals.values())


def loved_track_signals(tracks: list[LastfmLovedTrack]) -> list[ArtistSignal]:
    signals: dict[str, ArtistSignal] = {}
    for track in tracks:
        signal = signals.setdefault(
            name_key(track.artist_name),
            ArtistSignal(
                name=track.artist_name,
                url=track.artist_url,
                mbid=track.artist_mbid,
                evidence={"track_count": 0},
            ),
        )
        signal.evidence["track_count"] += 1
        signal.weight = float(signal.evidence["track_count"])
    return list(signals.values())


async def upsert_lastfm_artists(
    session: AsyncSession, signals: list[ArtistSignal]
) -> dict[str, uuid.UUID]:
    """Upsert Last.fm artist rows and their canonical artists, returning a
    name-key -> canonical artist id mapping."""
    result = await session.execute(
        select(LastfmArtist).where(
            LastfmArtist.name_key.in_([name_key(signal.name) for signal in signals])
        )
    )
    by_key = {row.name_key: row for row in result.scalars()}

    artist_ids: dict[str, uuid.UUID] = {}
    new_artists: dict[str, Artist] = {}
    new_signals: dict[str, ArtistSignal] = {}
    for signal in signals:
        key = name_key(signal.name)
        row = by_key.get(key)
        if row is None:
            artist = Artist(id=uuid.uuid7(), name=signal.name)
            session.add(artist)
            new_artists[key] = artist
            new_signals[key] = signal
            artist_ids[key] = artist.id
        else:
            if signal.url:
                row.url = signal.url
            if signal.mbid:
                row.mbid = signal.mbid
            artist_ids[key] = row.artist_id

    if new_artists:
        await session.flush()
        stmt = pg_insert(LastfmArtist).values(
            [
                {
                    "artist_id": new_artists[key].id,
                    "name": signal.name,
                    "name_key": key,
                    "url": signal.url,
                    "mbid": signal.mbid,
                }
                for key, signal in new_signals.items()
            ]
        )
        # A concurrent sync may have inserted the same artist between our select
        # and this insert; on conflict, defer to the committed row.
        stmt = stmt.on_conflict_do_update(
            index_elements=[LastfmArtist.name_key],
            set_={
                "url": func.coalesce(stmt.excluded.url, LastfmArtist.url),
                "mbid": func.coalesce(stmt.excluded.mbid, LastfmArtist.mbid),
            },
        ).returning(LastfmArtist.name_key, LastfmArtist.artist_id)
        result = await session.execute(stmt)
        for key, artist_id in result.all():
            if artist_id != new_artists[key].id:
                artist_ids[key] = artist_id
                await session.delete(new_artists[key])

    return artist_ids


async def sync_interests(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    signal_by_artist: dict[uuid.UUID, ArtistSignal],
    *,
    source: Source,
    prune: bool,
) -> ArtistSyncKindResult:
    """Reconcile the (user, kind) interest scope against the given signals:
    new artists get rows, survivors are updated in place (created_at
    preserved), and absent ones are deleted when pruning."""
    result = await session.execute(
        select(UserArtistInterest).where(
            UserArtistInterest.user_id == user_id, UserArtistInterest.kind == kind
        )
    )
    stale = {interest.artist_id: interest for interest in result.scalars()}

    created = updated = 0
    for artist_id, signal in signal_by_artist.items():
        interest = stale.pop(artist_id, None)
        if interest is None:
            session.add(
                UserArtistInterest(
                    user_id=user_id,
                    artist_id=artist_id,
                    kind=kind,
                    source=source,
                    evidence=signal.evidence,
                    weight=signal.weight,
                )
            )
            created += 1
        elif (interest.evidence, interest.weight) != (signal.evidence, signal.weight):
            interest.evidence = signal.evidence
            interest.weight = signal.weight
            updated += 1

    removed = 0
    if prune:
        for interest in stale.values():
            await session.delete(interest)
        removed = len(stale)

    return ArtistSyncKindResult(
        kind=kind,
        artists=len(signal_by_artist),
        interests_created=created,
        interests_updated=updated,
        interests_removed=removed,
    )
