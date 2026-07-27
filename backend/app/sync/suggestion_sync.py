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
from sqlalchemy.orm import aliased

from app.clients.lastfm import (
    LastfmApiError,
    LastfmArtistInfo,
    LastfmArtistNotFoundError,
    LastfmClient,
    LastfmSimilarArtistData,
)
from app.clients.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.core.models import (
    BandsintownArtist,
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
from app.sync.matching import KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND, upcoming_event_near

logger = logging.getLogger(__name__)

SIMILAR_TTL = timedelta(days=30)
INFO_TTL = timedelta(days=30)
SIMILAR_FETCH_LIMIT = 100
INFO_FETCH_LIMIT = 200
FETCH_CONCURRENCY = 4

# Artists are only considered known if user's playcount is above this floor
KNOWN_PLAYCOUNT_FLOOR = 20.0

LOVED_TRACK_AFFINITY_BASE = 0.4
LOVED_TRACK_AFFINITY_PER_TRACK = 0.15

QUALIFYING_PATH_VALUE = 0.2
CONSENSUS_BONUS = 0.05
CONSENSUS_MAX_PATHS = 4

SUGGESTION_ENTER_SCORE = 0.45
SUGGESTION_EXIT_SCORE = 0.35
SUGGESTION_BUDGET = 200

OVERALL_TOP_ARTISTS_LIMIT = 1000
EVIDENCE_PATHS_LIMIT = 3

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

    # ignore artists the user has explicitly hidden
    result = await session.execute(
        select(UserArtistExclusion.artist_id).where(UserArtistExclusion.user_id == user.id)
    )
    excluded_ids = set(result.scalars())

    # Paths starting from affinity < QUALIFYING_PATH_VALUE will never produce a
    # qualifying path.
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
        select(LastfmSimilarArtist).where(LastfmSimilarArtist.seed_artist_id.in_(eligible_ids))
    )
    edges = list(result.scalars())
    seed_names = {seed.artist_id: seed.name for seed in seeds}
    candidates = score_candidates(edges, affinities, seed_names)

    # filter out joint-credit keys (e.g. 'Turnstile & Blood Orange')
    joint_keys = await joint_credit_keys(
        session,
        lastfm,
        musicbrainz,
        [(c.name, c.mbid) for c in candidates if c.score >= SUGGESTION_EXIT_SCORE],
    )
    if joint_keys:
        candidates = [c for c in candidates if c.name_key not in joint_keys]

    # Don't suggest artists the user has listened to significantly
    known_keys = await _overall_known_artists_name_keys(lastfm, username)
    viable_keys = [c.name_key for c in candidates if c.score >= SUGGESTION_EXIT_SCORE]
    artist_ids_by_key = await _canonical_ids_by_key(session, viable_keys)
    alias_known_ids = await _known_act_alias_ids(
        session,
        {i.artist_id for i in interests if i.kind in KNOWN_ARTIST_KINDS},
        set(artist_ids_by_key.values()),
    )
    # Incumbent artists that become known should remain suggested if they have upcoming shows (this
    # avoids suggestions disappearing once the user starts listening to them in their playlists)
    graced_ids = await _artist_ids_with_upcoming_shows(session, user, set(incumbents))

    kept = select_suggestions(
        candidates,
        artist_ids_by_key,
        incumbent_ids=set(incumbents),
        known_ids=known_ids,
        known_keys=known_keys,
        alias_known_ids=alias_known_ids,
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
    # Re-read exclusions and filter out any new ones.
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
    artist_playcounts: dict[uuid.UUID, float] = {}
    loved_track_counts: dict[uuid.UUID, float] = {}
    for interest in interests:
        if interest.weight is None:
            continue
        if interest.kind == TOP_ARTIST_KIND:
            artist_playcounts[interest.artist_id] = interest.weight
        elif interest.kind == LOVED_TRACKS_KIND:
            loved_track_counts[interest.artist_id] = interest.weight

    max_playcount = max(artist_playcounts.values(), default=0.0)
    affinities: dict[uuid.UUID, float] = {}
    for artist_id in known_artist_ids(interests):
        playcount_affinity = 0.0
        playcount = artist_playcounts.get(artist_id)
        if playcount and max_playcount > 0:
            playcount_affinity = math.log1p(playcount) / math.log1p(max_playcount)

        track_count_affinity = 0.0
        track_count = loved_track_counts.get(artist_id)
        if track_count:
            track_count_affinity = min(
                LOVED_TRACK_AFFINITY_BASE + LOVED_TRACK_AFFINITY_PER_TRACK * track_count, 1.0
            )

        affinities[artist_id] = max(playcount_affinity, track_count_affinity)
    return affinities


def score_candidates(
    edges: list[LastfmSimilarArtist],
    affinities: dict[uuid.UUID, float],
    seed_names: dict[uuid.UUID, str],
) -> list[Candidate]:
    """Aggregate edges into per-candidate scores: best path first, plus a
    small capped bonus for additional paths from other seeds."""
    grouped: dict[str, list[tuple[LastfmSimilarArtist, Path]]] = {}
    for edge in edges:
        affinity = affinities.get(edge.seed_artist_id)
        if not affinity:
            continue
        path = Path(
            seed_artist_id=edge.seed_artist_id,
            seed_name=seed_names.get(edge.seed_artist_id, ""),
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
    known_keys: set[str],
    alias_known_ids: set[uuid.UUID],
    excluded_ids: set[uuid.UUID],
    graced_ids: set[uuid.UUID],
) -> list[Candidate]:
    """Filter out suggestions that fall below the suggestion thresholds"""

    def incumbent(candidate: Candidate) -> bool:
        return artist_ids_by_key.get(candidate.name_key) in incumbent_ids

    kept = []
    for candidate in candidates:
        # Artists that were previously suggested are judged against a lower floor to control
        # hysterisis (avoids churn for entries near ENTER_SCORE)
        threshold = SUGGESTION_EXIT_SCORE if incumbent(candidate) else SUGGESTION_ENTER_SCORE
        if candidate.score < threshold:
            continue
        artist_id = artist_ids_by_key.get(candidate.name_key)
        if artist_id in excluded_ids:
            continue
        # An alias of a known act is never suggestible, with no grace: its
        # shows already serve through the artist the user listens to.
        if artist_id in alias_known_ids:
            continue
        # Filter out artists the user knows, unless they're incumbent and graced
        known = artist_id in known_ids or candidate.name_key in known_keys
        if known and not (incumbent(candidate) and artist_id in graced_ids):
            continue
        kept.append(candidate)

    # Only keep SUGGESTION_BUDGET top matches, with ties broken by incumbency then name
    kept.sort(key=lambda c: (-c.score, not incumbent(c), c.name_key))
    return kept[:SUGGESTION_BUDGET]


async def joint_credit_keys(
    session: AsyncSession,
    lastfm: LastfmClient,
    musicbrainz: MusicBrainzClient,
    artists: Iterable[tuple[str, str | None]],
) -> set[str]:
    """
    Return keys among the given (name, mbid) pairs that are joint-credits names
    (e.g. "Turnstile & Blood Orange") rather than real artists.

    Verdicts are saved to the global joint_credit_verdicts cache for
    JOINT_CREDIT_VERDICT_TTL, so a stable candidate pool costs upstream calls
    once instead of every sync."""
    # Rule 1: if artist has MBID or does not contain a separator in the name
    # (',', '&', 'feat.'), then it is not a joint-credit name.
    names = {
        name_key(name): name
        for name, mbid in artists
        if mbid is None and JOINT_CREDIT_PATTERN.search(name)
    }
    if not names:
        return set()

    # Check existing verdicts in db - skip processing those within TTL.
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

    # Rule 2: if artist has tags in Last.fm, then it's a real atist (not a joint-credit name).
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

    # Rule 3: to confirm an suspected name is a joint-artist name, ensure it does not exist in
    # MusicBrainz. Names in MusicBrainz are trusted as real artists.
    for key in sorted(key for key, condemned in verdicts.items() if condemned):
        try:
            if await musicbrainz.has_artist_named(names[key]):
                verdicts[key] = False
        except MusicBrainzApiError, httpx.HTTPError:
            # A probe degraded by an upstream failure writes nothing, so the
            # next sync retries it: drop the key rather than cache a guess.
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
                LastfmSimilarArtist.seed_artist_id.in_([seed.artist_id for seed, _ in fetched])
            )
        )
    for seed, similar in fetched:
        deduped: dict[str, LastfmSimilarArtistData] = {}
        for entry in similar:
            key = name_key(entry.name)
            current = deduped.get(key)
            if current is None or entry.match > current.match:
                deduped[key] = entry
        if deduped:
            stmt = pg_insert(LastfmSimilarArtist).values(
                [
                    {
                        "seed_artist_id": seed.artist_id,
                        "name": entry.name,
                        "name_key": key,
                        "mbid": entry.mbid,
                        "match": entry.match,
                    }
                    for key, entry in deduped.items()
                ]
            )
            # A concurrent sync refreshing the same shared seed may have written
            # these edges between our delete and this insert; on conflict the
            # fresh fetch wins instead of the whole step failing.
            stmt = stmt.on_conflict_do_update(
                index_elements=[
                    LastfmSimilarArtist.seed_artist_id,
                    LastfmSimilarArtist.name_key,
                ],
                set_={
                    "name": stmt.excluded.name,
                    "mbid": stmt.excluded.mbid,
                    "match": stmt.excluded.match,
                },
            )
            await session.execute(stmt)
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
    missing or stale."""
    result = await session.execute(
        select(LastfmArtist).where(LastfmArtist.artist_id.in_(artist_ids))
    )
    stale = [
        row
        for row in result.scalars()
        if row.info_synced_at is None or now - row.info_synced_at >= INFO_TTL
    ]
    # Limit fan-out by only allowing up to INFO_FETCH_LIMIT artist fetches (priority_ids first).
    # Remaining ones gets synced on future syncs.
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


async def _overall_known_artists_name_keys(lastfm: LastfmClient, username: str) -> set[str]:
    """Return artists from user's overall (all-time) history with playcount
    above the configured floor. Swallow transient Last.fm failures to avoid
    failing the whole step - self-heals on the next run.
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


async def _known_act_alias_ids(
    session: AsyncSession, known_ids: set[uuid.UUID], candidate_ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of the given candidates share a Bandsintown identity with a
    known artist: the same act under another name. Identities are stamped by
    event sync, so a fresh alias slips through its first selection and is
    pruned on the next."""
    if not known_ids or not candidate_ids:
        return set()
    known_identity = aliased(BandsintownArtist)
    result = await session.execute(
        select(BandsintownArtist.artist_id)
        .join(known_identity, known_identity.external_id == BandsintownArtist.external_id)
        .where(
            BandsintownArtist.artist_id.in_(candidate_ids),
            known_identity.artist_id.in_(known_ids),
            known_identity.artist_id != BandsintownArtist.artist_id,
        )
    )
    return set(result.scalars())


async def _artist_ids_with_upcoming_shows(
    session: AsyncSession, user: User, artist_ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of the given artists have an upcoming concert near any of the
    user's cities (home city plus pinned playlist cities)."""
    if not artist_ids:
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
        .where(EventArtist.artist_id.in_(artist_ids), upcoming_event_near(cities))
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
            for path in candidate.paths[:EVIDENCE_PATHS_LIMIT]
        ],
    }
