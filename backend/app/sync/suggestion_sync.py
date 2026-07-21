import asyncio
import json
import logging
import math
import re
import uuid
from collections.abc import Awaitable, Callable, Iterable
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.lastfm import (
    LastfmApiError,
    LastfmArtistInfo,
    LastfmArtistNotFoundError,
    LastfmClient,
    LastfmSimilarArtistData,
)
from app.clients.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.core.models import (
    City,
    Event,
    EventArtist,
    JointCreditVerdict,
    LastfmArtist,
    LastfmSimilarArtist,
    Playlist,
    Source,
    User,
    UserArtistExclusion,
    UserArtistInterest,
)
from app.core.schemas import SuggestionSyncResult
from app.sync.artist_sync import (
    LOVED_TRACKS_KIND,
    TOP_ARTIST_KIND,
    ArtistSignal,
    name_key,
    sync_interests,
    upsert_lastfm_artists,
)
from app.sync.matching import SIMILAR_ARTIST_KIND, upcoming_event_near

logger = logging.getLogger(__name__)

SIMILAR_TTL = timedelta(days=30)
INFO_TTL = timedelta(days=30)
SIMILAR_FETCH_LIMIT = 100
INFO_FETCH_LIMIT = 200
FETCH_CONCURRENCY = 4

# A lastfm_top_artist interest counts toward the known classification only
# above this playcount: presence is not knowing, and the floor keeps playlist
# scrobbles from evicting the suggestions that caused them.
KNOWN_PLAYCOUNT_FLOOR = 20.0

LOVED_AFFINITY_BASE = 0.4
LOVED_AFFINITY_PER_TRACK = 0.15

# Paths below this value neither earn the consensus bonus nor, therefore,
# change any output - which is also why seeds with affinity below it are
# provably safe to skip fetching (path value never exceeds affinity).
QUALIFYING_PATH_VALUE = 0.2
CONSENSUS_BONUS = 0.05
CONSENSUS_MAX_PATHS = 4

SUGGESTION_ENTER_SCORE = 0.45
SUGGESTION_EXIT_SCORE = 0.35
SUGGESTION_BUDGET = 200

OVERALL_TOP_ARTISTS_LIMIT = 1000
EVIDENCE_PATH_COUNT = 3

JOINT_CREDIT_PATTERN = re.compile(r"[,&]|\b(?:feat|ft|featuring|vs)\b\.?|\sx\s", re.IGNORECASE)
JOINT_CREDIT_VERDICT_TTL = timedelta(days=90)


class Path(BaseModel):
    """One seed-to-candidate similarity edge, weighted by the seed's affinity."""

    seed_artist_id: uuid.UUID
    seed_name: str
    match: float
    value: float


class Candidate(BaseModel):
    """A similar artist aggregated across every seed that recommends it."""

    name: str
    name_key: str
    mbid: str | None
    score: float
    paths: list[Path]


async def sync_user_suggestions(
    session: AsyncSession,
    lastfm: LastfmClient,
    musicbrainz: MusicBrainzClient,
    user: User,
    username: str,
) -> SuggestionSyncResult:
    """Recompute the user's suggested artists and reconcile their
    similar_artist interest rows against the result.

    The previous suggestion set is deliberately an input (incumbency drives
    the exit threshold and concert-tied grace), and every existing row is either
    re-confirmed or deleted - an incumbent absent from the scoring output is
    a zero, not an unknown.
    """
    now = datetime.now(UTC)

    result = await session.execute(
        select(UserArtistInterest).where(UserArtistInterest.user_id == user.id)
    )
    interests = list(result.scalars())
    known_ids = known_artist_ids(interests)
    affinities = seed_affinities(interests)
    incumbents = {i.artist_id: i for i in interests if i.kind == SIMILAR_ARTIST_KIND}

    result = await session.execute(
        select(UserArtistExclusion.artist_id).where(UserArtistExclusion.user_id == user.id)
    )
    excluded_ids = set(result.scalars())

    eligible_ids = {
        artist_id
        for artist_id, affinity in affinities.items()
        if affinity >= QUALIFYING_PATH_VALUE and artist_id not in excluded_ids
    }
    result = await session.execute(
        select(LastfmArtist).where(LastfmArtist.artist_id.in_(eligible_ids))
    )
    seeds = list(result.scalars())

    stale = [
        seed
        for seed in seeds
        if seed.similar_synced_at is None or now - seed.similar_synced_at >= SIMILAR_TTL
    ]
    synced, failed = await _refresh_seed_edges(session, lastfm, stale, now)

    result = await session.execute(
        select(LastfmSimilarArtist).where(LastfmSimilarArtist.artist_id.in_(eligible_ids))
    )
    edges = list(result.scalars())
    seed_names = {seed.artist_id: seed.name for seed in seeds}
    candidates = score_candidates(edges, affinities, seed_names)

    # Only candidates that could pass a threshold are worth probing.
    joint_keys = await joint_credit_keys(
        session,
        lastfm,
        musicbrainz,
        [(c.name, c.mbid) for c in candidates if c.score >= SUGGESTION_EXIT_SCORE],
    )
    if joint_keys:
        candidates = [c for c in candidates if c.name_key not in joint_keys]

    blocked_keys = await _blocked_name_keys(lastfm, username)
    # Below the exit score a candidate fails both thresholds regardless of
    # incumbency, so only the rest ever need a canonical id.
    viable_keys = [c.name_key for c in candidates if c.score >= SUGGESTION_EXIT_SCORE]
    artist_ids_by_key = await _canonical_ids_by_key(session, viable_keys)
    graced_ids = await _graced_artist_ids(session, user, set(incumbents))

    kept = select_suggestions(
        candidates,
        artist_ids_by_key,
        incumbent_ids=set(incumbents),
        known_ids=known_ids,
        blocked_keys=blocked_keys,
        excluded_ids=excluded_ids,
        graced_ids=graced_ids,
    )

    # Only selected candidates get canonical artist rows; the interest write
    # is the same reconcile every taste kind uses, so an incumbent absent
    # from the selection is deleted, and survivors keep their created_at.
    signals = [
        ArtistSignal(name=c.name, url=None, mbid=c.mbid, evidence=_evidence(c), weight=c.score)
        for c in kept
    ]
    artist_ids = await upsert_lastfm_artists(session, signals)
    # An exclusion committed while the fetches above ran is missing from the
    # snapshot the selection used; re-read so the reconcile drops the artist
    # instead of resurrecting the interest the exclusion write just deleted.
    result = await session.execute(
        select(UserArtistExclusion.artist_id).where(UserArtistExclusion.user_id == user.id)
    )
    excluded_ids = set(result.scalars())
    signal_by_artist = {
        artist_id: signal
        for signal in signals
        if (artist_id := artist_ids[name_key(signal.name)]) not in excluded_ids
    }
    written = await sync_interests(
        session, user.id, SIMILAR_ARTIST_KIND, signal_by_artist, source=Source.INTERNAL, prune=True
    )

    enrich_ids = {interest.artist_id for interest in interests} | set(signal_by_artist)
    enriched, enrich_failed = await _enrich_artist_info(
        session, lastfm, enrich_ids, now, priority_ids=frozenset(signal_by_artist)
    )

    return SuggestionSyncResult(
        synced_at=now,
        seeds_total=len(seeds),
        seeds_synced=synced,
        seeds_skipped=len(seeds) - len(stale),
        seeds_failed=failed,
        candidates_scored=len(candidates),
        suggestions_created=written.interests_created,
        suggestions_kept=len(kept) - written.interests_created,
        suggestions_removed=written.interests_removed,
        artists_enriched=enriched,
        artists_enrich_failed=enrich_failed,
    )


def known_artist_ids(interests: list[UserArtistInterest]) -> set[uuid.UUID]:
    """Artists the user demonstrably listens to: a loved track (an explicit
    act, no floor), or a top-artist playcount clearing the floor."""
    known = set()
    for interest in interests:
        if interest.kind == LOVED_TRACKS_KIND:
            known.add(interest.artist_id)
        elif interest.kind == TOP_ARTIST_KIND and (interest.weight or 0) >= KNOWN_PLAYCOUNT_FLOOR:
            known.add(interest.artist_id)
    return known


def seed_affinities(interests: list[UserArtistInterest]) -> dict[uuid.UUID, float]:
    """Affinity (0-1) for every known artist; an artist known through both
    signals takes the stronger."""
    playcounts: dict[uuid.UUID, float] = {}
    track_counts: dict[uuid.UUID, float] = {}
    for interest in interests:
        if interest.weight is None:
            continue
        if interest.kind == TOP_ARTIST_KIND:
            playcounts[interest.artist_id] = interest.weight
        elif interest.kind == LOVED_TRACKS_KIND:
            track_counts[interest.artist_id] = interest.weight

    max_playcount = max(playcounts.values(), default=0.0)
    affinities: dict[uuid.UUID, float] = {}
    for artist_id in known_artist_ids(interests):
        affinity = 0.0
        playcount = playcounts.get(artist_id)
        if playcount and max_playcount > 0:
            affinity = math.log1p(playcount) / math.log1p(max_playcount)
        track_count = track_counts.get(artist_id)
        if track_count:
            affinity = max(
                affinity, min(LOVED_AFFINITY_BASE + LOVED_AFFINITY_PER_TRACK * track_count, 1.0)
            )
        affinities[artist_id] = affinity
    return affinities


def score_candidates(
    edges: list[LastfmSimilarArtist],
    affinities: dict[uuid.UUID, float],
    seed_names: dict[uuid.UUID, str],
) -> list[Candidate]:
    """Aggregate edges into per-candidate scores: best path first, plus a
    small capped bonus for consensus across seeds."""
    grouped: dict[str, list[tuple[LastfmSimilarArtist, Path]]] = {}
    for edge in edges:
        affinity = affinities.get(edge.artist_id)
        if not affinity:
            continue
        path = Path(
            seed_artist_id=edge.artist_id,
            seed_name=seed_names.get(edge.artist_id, ""),
            match=edge.match,
            value=edge.match * affinity,
        )
        grouped.setdefault(edge.name_key, []).append((edge, path))

    candidates = []
    for key, pairs in grouped.items():
        pairs.sort(key=lambda pair: (-pair[1].value, pair[1].seed_name))
        paths = [path for _, path in pairs]
        consensus = sum(1 for path in paths[1:] if path.value >= QUALIFYING_PATH_VALUE)
        score = paths[0].value + CONSENSUS_BONUS * min(consensus, CONSENSUS_MAX_PATHS)
        best_edge = pairs[0][0]
        mbid = next((edge.mbid for edge, _ in pairs if edge.mbid), None)
        candidates.append(
            Candidate(name=best_edge.name, name_key=key, mbid=mbid, score=score, paths=paths)
        )
    return candidates


def select_suggestions(
    candidates: list[Candidate],
    artist_ids_by_key: dict[str, uuid.UUID],
    *,
    incumbent_ids: set[uuid.UUID],
    known_ids: set[uuid.UUID],
    blocked_keys: set[str],
    excluded_ids: set[uuid.UUID],
    graced_ids: set[uuid.UUID],
) -> list[Candidate]:
    """Apply thresholds with hysteresis, the known-artist filter with its
    concert-tied grace, exclusions, and the budget. Deterministic: ties break by
    incumbency, then name_key."""

    def incumbent(candidate: Candidate) -> bool:
        return artist_ids_by_key.get(candidate.name_key) in incumbent_ids

    kept = []
    for candidate in candidates:
        threshold = SUGGESTION_EXIT_SCORE if incumbent(candidate) else SUGGESTION_ENTER_SCORE
        if candidate.score < threshold:
            continue
        artist_id = artist_ids_by_key.get(candidate.name_key)
        if artist_id in excluded_ids:
            continue
        known = artist_id in known_ids or candidate.name_key in blocked_keys
        if known and not (incumbent(candidate) and artist_id in graced_ids):
            continue
        kept.append(candidate)

    kept.sort(key=lambda c: (-c.score, not incumbent(c), c.name_key))
    return kept[:SUGGESTION_BUDGET]


async def joint_credit_keys(
    session: AsyncSession,
    lastfm: LastfmClient,
    musicbrainz: MusicBrainzClient,
    artists: Iterable[tuple[str, str | None]],
) -> set[str]:
    """Name keys among the given (name, mbid) pairs that are joint-credit pages
    Last.fm auto-created from multi-artist scrobble credits ("Turnstile & Blood
    Orange") rather than real artists.

    A suspect is a separator-bearing name without an MBID; the verdict is zero
    tags, which nobody applies to auto-created pages while real separator-bearing
    names ("Earth, Wind & Fire") carry them even when Last.fm omits the MBID.
    The registry answers for names it has info for; the rest cost one getInfo
    each. A MusicBrainz artist entity with the exact name or alias then rescues
    the would-be drops - MusicBrainz models joint credits as artist credits,
    never entities, so its registry is the maintained exception list for real
    separator-bearing names Last.fm has neither an MBID nor tags for. Any
    upstream being unreachable keeps the name until the next sync.

    Clean verdicts persist to the global joint_credit_verdicts cache for
    JOINT_CREDIT_VERDICT_TTL, so a stable candidate pool costs upstream calls
    once instead of every sync; degraded probes stay uncached and retry.
    Fresh drops log at WARNING so only new decisions surface in Sentry."""
    names = {
        name_key(name): name
        for name, mbid in artists
        if mbid is None and JOINT_CREDIT_PATTERN.search(name)
    }
    if not names:
        return set()

    now = datetime.now(UTC)
    dropped: set[str] = set()
    result = await session.execute(
        select(JointCreditVerdict).where(JointCreditVerdict.name_key.in_(names))
    )
    for row in result.scalars():
        if now - row.checked_at >= JOINT_CREDIT_VERDICT_TTL:
            continue
        if row.is_joint_credit:
            dropped.add(row.name_key)
        del names[row.name_key]
    if not names:
        return dropped

    verdicts: dict[str, bool] = {}
    result = await session.execute(select(LastfmArtist).where(LastfmArtist.name_key.in_(names)))
    unprobed = dict(names)
    for row in result.scalars():
        if row.info_synced_at is None:
            continue
        del unprobed[row.name_key]
        verdicts[row.name_key] = row.mbid is None and not row.tags

    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    infos = await asyncio.gather(
        *(_fetch_info(lastfm, name, semaphore) for name in unprobed.values())
    )
    for key, info in zip(unprobed, infos, strict=True):
        if info is not None:
            verdicts[key] = info.mbid is None and not info.tags

    for key in sorted(key for key, condemned in verdicts.items() if condemned):
        try:
            if await musicbrainz.has_artist_named(names[key]):
                verdicts[key] = False
        except MusicBrainzApiError, httpx.HTTPError:
            del verdicts[key]

    fresh = {key for key, condemned in verdicts.items() if condemned}
    if fresh:
        logger.warning(
            "Dropped %d joint-credit suggestion candidates: %s",
            len(fresh),
            "; ".join(sorted(names[key] for key in fresh)),
        )
    if verdicts:
        stmt = pg_insert(JointCreditVerdict).values(
            [
                {
                    "name": names[key],
                    "name_key": key,
                    "is_joint_credit": condemned,
                    "checked_at": now,
                }
                for key, condemned in verdicts.items()
            ]
        )
        # A concurrent sync may have cached the same name between our select
        # and this insert; the newer probe wins.
        stmt = stmt.on_conflict_do_update(
            index_elements=[JointCreditVerdict.name_key],
            set_={
                "is_joint_credit": stmt.excluded.is_joint_credit,
                "checked_at": stmt.excluded.checked_at,
            },
        )
        await session.execute(stmt)
    return dropped | fresh


async def _refresh_seed_edges(
    session: AsyncSession, lastfm: LastfmClient, seeds: list[LastfmArtist], now: datetime
) -> tuple[int, int]:
    """Re-fetch stale seeds' similar lists, replacing each seed's whole edge
    set. Fetches run concurrently; all session writes stay on this task."""
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    outcomes = await asyncio.gather(
        *(_fetch_similar(lastfm, seed.name, semaphore) for seed in seeds)
    )

    # Failed fetches keep their old edges and their stale similar_synced_at,
    # so the next sync retries them.
    fetched = [
        (seed, similar)
        for seed, similar in zip(seeds, outcomes, strict=True)
        if similar is not None
    ]
    if fetched:
        await session.execute(
            delete(LastfmSimilarArtist).where(
                LastfmSimilarArtist.artist_id.in_([seed.artist_id for seed, _ in fetched])
            )
        )
    for seed, similar in fetched:
        deduped: dict[str, LastfmSimilarArtistData] = {}
        for entry in similar:
            deduped.setdefault(name_key(entry.name), entry)
        for key, entry in deduped.items():
            session.add(
                LastfmSimilarArtist(
                    artist_id=seed.artist_id,
                    name=entry.name,
                    name_key=key,
                    mbid=entry.mbid,
                    match=entry.match,
                )
            )
        seed.similar_synced_at = now
    return len(fetched), len(seeds) - len(fetched)


async def _fetch_similar(
    lastfm: LastfmClient, name: str, semaphore: asyncio.Semaphore
) -> list[LastfmSimilarArtistData] | None:
    return await _guarded_fetch(
        lambda: lastfm.get_similar_artists(name, limit=SIMILAR_FETCH_LIMIT), [], semaphore
    )


async def _guarded_fetch[T](
    fetch: Callable[[], Awaitable[T]], not_found: T, semaphore: asyncio.Semaphore
) -> T | None:
    """None means a transient failure that should not stamp the freshness
    timestamp; an artist unknown to Last.fm durably yields not_found."""
    async with semaphore:
        try:
            return await fetch()
        except LastfmArtistNotFoundError:
            return not_found
        except LastfmApiError, httpx.HTTPError, json.JSONDecodeError:
            return None


async def _enrich_artist_info(
    session: AsyncSession,
    lastfm: LastfmClient,
    artist_ids: set[uuid.UUID],
    now: datetime,
    *,
    priority_ids: frozenset[uuid.UUID] = frozenset(),
) -> tuple[int, int]:
    """Fill url, listening stats, and tags for interest artists whose info is
    missing or stale. The registry is global, so one user's sync serves every
    user reading the same artist."""
    result = await session.execute(
        select(LastfmArtist).where(LastfmArtist.artist_id.in_(artist_ids))
    )
    stale = [
        row
        for row in result.scalars()
        if row.info_synced_at is None or now - row.info_synced_at >= INFO_TTL
    ]
    # A cold registry can make this the sync's biggest fan-out; the cap bounds
    # one run, and the rows left stale complete over the following syncs.
    # Priority rows (the current suggestions, whose panel shows the tags) go
    # ahead of the rest.
    stale.sort(key=lambda row: row.artist_id not in priority_ids)
    rows = stale[:INFO_FETCH_LIMIT]
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    outcomes = await asyncio.gather(*(_fetch_info(lastfm, row.name, semaphore) for row in rows))

    # Failed fetches keep their old info and their stale info_synced_at, so
    # the next sync retries them.
    enriched = 0
    for row, info in zip(rows, outcomes, strict=True):
        if info is None:
            continue
        if info.url:
            row.url = info.url
        if info.mbid:
            row.mbid = info.mbid
        row.listeners = info.listeners
        row.playcount = info.playcount
        row.tags = info.tags
        row.info_synced_at = now
        enriched += 1
    return enriched, len(rows) - enriched


async def _fetch_info(
    lastfm: LastfmClient, name: str, semaphore: asyncio.Semaphore
) -> LastfmArtistInfo | None:
    empty = LastfmArtistInfo(
        name=name, url=None, mbid=None, listeners=None, playcount=None, tags=[]
    )
    return await _guarded_fetch(lambda: lastfm.get_artist_info(name), empty, semaphore)


async def _blocked_name_keys(lastfm: LastfmClient, username: str) -> set[str]:
    """The user's overall-period top artists above the playcount floor, as an
    in-memory blocklist: catches artists known well but not played lately.

    A transient Last.fm failure here degrades to an empty blocklist for this
    run instead of failing the whole step: known_ids still filters, and the
    next sync rebuilds the list.
    """
    try:
        top_artists = await lastfm.get_top_artists(
            username, period="overall", limit=OVERALL_TOP_ARTISTS_LIMIT
        )
    except LastfmApiError, httpx.HTTPError, json.JSONDecodeError:
        return set()
    return {
        name_key(artist.name)
        for artist in top_artists
        if artist.playcount is not None and artist.playcount >= KNOWN_PLAYCOUNT_FLOOR
    }


async def _canonical_ids_by_key(
    session: AsyncSession, name_keys: list[str]
) -> dict[str, uuid.UUID]:
    if not name_keys:
        return {}
    result = await session.execute(
        select(LastfmArtist.name_key, LastfmArtist.artist_id).where(
            LastfmArtist.name_key.in_(name_keys)
        )
    )
    return {key: artist_id for key, artist_id in result.all()}


async def _graced_artist_ids(
    session: AsyncSession, user: User, incumbent_ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    """Incumbents with an upcoming concert near any of the user's playlist
    target cities - the same servable predicate the match join runs on.
    Grace retains, never admits: it only ever excuses known-ness."""
    if not incumbent_ids:
        return set()
    result = await session.execute(
        select(Playlist.city_id).where(Playlist.user_id == user.id, Playlist.city_id.is_not(None))
    )
    city_ids = set(result.scalars())
    if user.city_id is not None:
        city_ids.add(user.city_id)
    if not city_ids:
        return set()
    result = await session.execute(select(City).where(City.geonameid.in_(city_ids)))
    cities = list(result.scalars())

    result = await session.execute(
        select(EventArtist.artist_id)
        .join(Event, Event.id == EventArtist.event_id)
        .where(EventArtist.artist_id.in_(incumbent_ids), upcoming_event_near(cities))
        .distinct()
    )
    return set(result.scalars())


def _evidence(candidate: Candidate) -> dict:
    return {
        "score": round(candidate.score, 4),
        "paths": [
            {
                "seed_artist_id": str(path.seed_artist_id),
                "seed_name": path.seed_name,
                "match": path.match,
            }
            for path in candidate.paths[:EVIDENCE_PATH_COUNT]
        ],
    }
