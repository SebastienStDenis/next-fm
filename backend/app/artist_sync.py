import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.lastfm import LastfmClient, LastfmLovedTrack, LastfmTopArtist
from app.models import Artist, LastfmArtist, UserArtistInterest
from app.schemas import ArtistSyncKindResult

TOP_ARTIST_KIND = "lastfm_top_artist"
LOVED_TRACKS_KIND = "lastfm_loved_tracks"
SYNC_KINDS = (TOP_ARTIST_KIND, LOVED_TRACKS_KIND)
LASTFM_SOURCE = "lastfm"

TOP_ARTISTS_PERIOD = "12month"
TOP_ARTISTS_LIMIT = 200
LOVED_TRACKS_PAGE_SIZE = 200
LOVED_TRACKS_MAX_PAGES = 10


class ArtistSignal(BaseModel):
    """One artist-level taste signal extracted from a Last.fm response."""

    name: str
    url: str | None
    mbid: str | None
    evidence: dict


async def sync_lastfm_artists(
    session: AsyncSession,
    lastfm: LastfmClient,
    user_id: uuid.UUID,
    username: str,
    kinds: Sequence[str],
) -> list[ArtistSyncKindResult]:
    """Fetch taste signals from Last.fm and upsert artists and interests.

    Each kind is synced as a full replacement of that (user, kind) scope:
    interests for artists no longer present in the fetched data are deleted.
    """
    results = []
    for kind in kinds:
        signals = await _fetch_signals(lastfm, username, kind)
        artist_ids = await _upsert_lastfm_artists(session, signals)
        evidence_by_artist = {
            artist_ids[signal.name.lower()]: signal.evidence for signal in signals
        }
        results.append(await _sync_interests(session, user_id, kind, evidence_by_artist))
    return results


async def _fetch_signals(lastfm: LastfmClient, username: str, kind: str) -> list[ArtistSignal]:
    if kind == TOP_ARTIST_KIND:
        top_artists = await lastfm.get_top_artists(
            username, period=TOP_ARTISTS_PERIOD, limit=TOP_ARTISTS_LIMIT
        )
        return top_artist_signals(top_artists)
    if kind == LOVED_TRACKS_KIND:
        tracks: list[LastfmLovedTrack] = []
        page = 1
        while page <= LOVED_TRACKS_MAX_PAGES:
            result = await lastfm.get_loved_tracks(
                username, limit=LOVED_TRACKS_PAGE_SIZE, page=page
            )
            tracks.extend(result.tracks)
            if page >= result.total_pages:
                break
            page += 1
        return loved_track_signals(tracks)
    raise ValueError(f"Unknown sync kind: {kind}")


def top_artist_signals(top_artists: list[LastfmTopArtist]) -> list[ArtistSignal]:
    signals: dict[str, ArtistSignal] = {}
    for artist in top_artists:
        signals.setdefault(
            artist.name.lower(),
            ArtistSignal(
                name=artist.name,
                url=artist.url,
                mbid=artist.mbid,
                evidence={
                    "rank": artist.rank,
                    "playcount": artist.playcount,
                    "period": TOP_ARTISTS_PERIOD,
                },
            ),
        )
    return list(signals.values())


def loved_track_signals(tracks: list[LastfmLovedTrack]) -> list[ArtistSignal]:
    signals: dict[str, ArtistSignal] = {}
    for track in tracks:
        signal = signals.setdefault(
            track.artist_name.lower(),
            ArtistSignal(
                name=track.artist_name,
                url=track.artist_url,
                mbid=track.artist_mbid,
                evidence={"track_count": 0},
            ),
        )
        signal.evidence["track_count"] += 1
    return list(signals.values())


async def _upsert_lastfm_artists(
    session: AsyncSession, signals: list[ArtistSignal]
) -> dict[str, uuid.UUID]:
    """Upsert Last.fm artist rows (keyed by lowercased name) and their canonical
    artists, returning a lowercased-name -> canonical artist id mapping."""
    keys = [signal.name.lower() for signal in signals]
    result = await session.execute(
        select(LastfmArtist).where(func.lower(LastfmArtist.name).in_(keys))
    )
    by_key = {row.name.lower(): row for row in result.scalars()}

    now = datetime.now(UTC)
    for signal in signals:
        row = by_key.get(signal.name.lower())
        if row is None:
            artist = Artist(id=uuid.uuid7(), name=signal.name)
            session.add(artist)
            row = LastfmArtist(artist_id=artist.id, name=signal.name)
            session.add(row)
            by_key[signal.name.lower()] = row
        if signal.url:
            row.url = signal.url
        if signal.mbid:
            row.mbid = signal.mbid
        row.last_synced_at = now
    await session.flush()
    return {key: row.artist_id for key, row in by_key.items()}


async def _sync_interests(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: str,
    evidence_by_artist: dict[uuid.UUID, dict],
) -> ArtistSyncKindResult:
    result = await session.execute(
        select(UserArtistInterest).where(
            UserArtistInterest.user_id == user_id, UserArtistInterest.kind == kind
        )
    )
    stale = {interest.artist_id: interest for interest in result.scalars()}

    created = updated = 0
    for artist_id, evidence in evidence_by_artist.items():
        interest = stale.pop(artist_id, None)
        if interest is None:
            session.add(
                UserArtistInterest(
                    user_id=user_id,
                    artist_id=artist_id,
                    kind=kind,
                    source=LASTFM_SOURCE,
                    evidence=evidence,
                )
            )
            created += 1
        elif interest.evidence != evidence:
            interest.evidence = evidence
            updated += 1

    for interest in stale.values():
        await session.delete(interest)

    return ArtistSyncKindResult(
        kind=kind,
        artists=len(evidence_by_artist),
        interests_created=created,
        interests_updated=updated,
        interests_removed=len(stale),
    )
