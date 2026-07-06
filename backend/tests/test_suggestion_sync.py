import math
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.artist_sync import LOVED_TRACKS_KIND, TOP_ARTIST_KIND, name_key
from app.lastfm import (
    LastfmApiError,
    LastfmArtistNotFoundError,
    LastfmClient,
    LastfmSimilarArtistData,
    LastfmTopArtist,
)
from app.matching import SIMILAR_ARTIST_KIND
from app.models import (
    Artist,
    LastfmAccount,
    LastfmArtist,
    LastfmSimilarArtist,
    UserArtistInterest,
)
from app.suggestion_sync import (
    CONSENSUS_BONUS,
    KNOWN_PLAYCOUNT_FLOOR,
    SUGGESTION_BUDGET,
    Candidate,
    _refresh_seed_edges,
    known_artist_ids,
    score_candidates,
    seed_affinities,
    select_suggestions,
)
from tests.helpers import (
    added_objects,
    make_session,
    request,
    result_returning,
    result_with_rows,
    result_with_scalars,
)

USER_ID = uuid.uuid7()
SYNC_URL = f"/users/{USER_ID}/suggestions/sync"


def interest(kind: str, weight: float | None, artist_id: uuid.UUID | None = None):
    return UserArtistInterest(
        user_id=USER_ID,
        artist_id=artist_id or uuid.uuid7(),
        kind=kind,
        source="lastfm",
        evidence={},
        weight=weight,
    )


def test_known_requires_playcount_floor_but_not_for_loved_tracks() -> None:
    heavy = interest(TOP_ARTIST_KIND, KNOWN_PLAYCOUNT_FLOOR)
    trace = interest(TOP_ARTIST_KIND, KNOWN_PLAYCOUNT_FLOOR - 1)
    unweighted = interest(TOP_ARTIST_KIND, None)
    loved = interest(LOVED_TRACKS_KIND, 1.0)
    suggested = interest(SIMILAR_ARTIST_KIND, 0.5)

    known = known_artist_ids([heavy, trace, unweighted, loved, suggested])

    assert known == {heavy.artist_id, loved.artist_id}


def test_seed_affinity_scales_playcount_against_the_users_own_max() -> None:
    top = interest(TOP_ARTIST_KIND, 1000.0)
    mid = interest(TOP_ARTIST_KIND, 100.0)

    affinities = seed_affinities([top, mid])

    assert affinities[top.artist_id] == 1.0
    assert affinities[mid.artist_id] == math.log1p(100) / math.log1p(1000)


def test_seed_affinity_for_loved_only_seeds_uses_track_count() -> None:
    one_track = interest(LOVED_TRACKS_KIND, 1.0)
    many_tracks = interest(LOVED_TRACKS_KIND, 10.0)

    affinities = seed_affinities([one_track, many_tracks])

    assert affinities[one_track.artist_id] == pytest.approx(0.55)
    assert affinities[many_tracks.artist_id] == 1.0  # capped


def test_seed_affinity_takes_the_stronger_signal() -> None:
    artist_id = uuid.uuid7()
    top = interest(TOP_ARTIST_KIND, 1000.0)
    weak_top = interest(TOP_ARTIST_KIND, 10.0, artist_id=artist_id)
    loved = interest(LOVED_TRACKS_KIND, 2.0, artist_id=artist_id)

    affinities = seed_affinities([top, weak_top, loved])

    assert affinities[artist_id] == pytest.approx(0.7)  # loved formula beats the log ratio


def edge(seed_id: uuid.UUID, name: str, match: float, mbid: str | None = None):
    return LastfmSimilarArtist(
        artist_id=seed_id, name=name, name_key=name_key(name), mbid=mbid, match=match
    )


def test_score_takes_best_path_plus_capped_consensus_bonus() -> None:
    seeds = [uuid.uuid7() for _ in range(7)]
    affinities = dict.fromkeys(seeds, 1.0)
    names = {seed: f"Seed {i}" for i, seed in enumerate(seeds)}
    edges = [edge(seeds[0], "Candidate", 0.8)]
    edges += [edge(seed, "Candidate", 0.5) for seed in seeds[1:6]]
    edges += [edge(seeds[6], "Candidate", 0.1)]  # below the qualifying bar

    candidates = score_candidates(edges, affinities, names)

    assert len(candidates) == 1
    assert candidates[0].score == pytest.approx(0.8 + CONSENSUS_BONUS * 4)
    assert candidates[0].paths[0].seed_name == "Seed 0"


def test_score_weights_paths_by_seed_affinity_and_ignores_unknown_seeds() -> None:
    strong, weak, ineligible = uuid.uuid7(), uuid.uuid7(), uuid.uuid7()
    affinities = {strong: 1.0, weak: 0.5}
    names = {strong: "Strong", weak: "Weak"}
    edges = [
        edge(weak, "Candidate", 1.0),
        edge(strong, "Candidate", 0.6),
        edge(ineligible, "Candidate", 1.0),
    ]

    candidates = score_candidates(edges, affinities, names)

    # strong path 0.6 beats weak path 0.5, which still earns the bonus
    assert candidates[0].score == pytest.approx(0.6 + CONSENSUS_BONUS)
    assert [path.seed_name for path in candidates[0].paths] == ["Strong", "Weak"]


def test_score_keeps_first_non_null_mbid() -> None:
    a, b = uuid.uuid7(), uuid.uuid7()
    edges = [edge(a, "Candidate", 0.9), edge(b, "Candidate", 0.5, mbid="mbid-1")]

    candidates = score_candidates(edges, {a: 1.0, b: 1.0}, {a: "A", b: "B"})

    assert candidates[0].mbid == "mbid-1"


def candidate(name: str, score: float) -> Candidate:
    return Candidate(name=name, name_key=name_key(name), mbid=None, score=score, paths=[])


def keys(kept: list[Candidate]) -> list[str]:
    return [c.name_key for c in kept]


def select(candidates: list[Candidate], ids: dict[str, uuid.UUID], **overrides):
    defaults: dict = {
        "incumbent_ids": set(),
        "known_ids": set(),
        "blocked_keys": set(),
        "excluded_ids": set(),
        "graced_ids": set(),
    }
    return select_suggestions(candidates, ids, **{**defaults, **overrides})


def test_selection_applies_enter_and_exit_thresholds_with_hysteresis() -> None:
    incumbent_id = uuid.uuid7()
    ids = {"incumbent": incumbent_id}
    candidates = [candidate("Incumbent", 0.4), candidate("Newcomer", 0.4), candidate("Star", 0.5)]

    kept = select(candidates, ids, incumbent_ids={incumbent_id})

    assert keys(kept) == ["star", "incumbent"]


def test_selection_drops_incumbents_below_the_exit_threshold() -> None:
    incumbent_id = uuid.uuid7()

    kept = select(
        [candidate("Fading", 0.3)], {"fading": incumbent_id}, incumbent_ids={incumbent_id}
    )

    assert kept == []


def test_selection_drops_known_candidates_unless_graced_incumbents() -> None:
    known_new, known_kept, known_dropped = uuid.uuid7(), uuid.uuid7(), uuid.uuid7()
    ids = {"new": known_new, "graced": known_kept, "ungraced": known_dropped}
    candidates = [candidate("New", 0.9), candidate("Graced", 0.9), candidate("Ungraced", 0.9)]

    kept = select(
        candidates,
        ids,
        incumbent_ids={known_kept, known_dropped},
        known_ids={known_new, known_kept, known_dropped},
        graced_ids={known_kept},
    )

    assert keys(kept) == ["graced"]


def test_selection_blocklist_drops_by_name_key() -> None:
    kept = select(
        [candidate("Blocked", 0.9), candidate("Fresh", 0.9)], {}, blocked_keys={"blocked"}
    )

    assert keys(kept) == ["fresh"]


def test_selection_exclusion_beats_grace() -> None:
    artist_id = uuid.uuid7()

    kept = select(
        [candidate("Excluded", 0.9)],
        {"excluded": artist_id},
        incumbent_ids={artist_id},
        known_ids={artist_id},
        excluded_ids={artist_id},
        graced_ids={artist_id},
    )

    assert kept == []


def test_selection_ranks_by_score_then_incumbency_then_name_key() -> None:
    incumbent_id = uuid.uuid7()
    ids = {"b incumbent": incumbent_id}
    candidates = [
        candidate("Z Cheap", 0.5),
        candidate("A New", 0.6),
        candidate("B Incumbent", 0.6),
    ]

    kept = select(candidates, ids, incumbent_ids={incumbent_id})

    assert keys(kept) == ["b incumbent", "a new", "z cheap"]


def test_selection_caps_at_the_budget() -> None:
    candidates = [candidate(f"Artist {i:03}", 0.9) for i in range(SUGGESTION_BUDGET + 10)]

    kept = select(candidates, {})

    assert len(kept) == SUGGESTION_BUDGET
    assert keys(kept) == sorted(keys(kept))


NOW = datetime(2026, 7, 6, 12, 0, tzinfo=UTC)


def make_seed(name: str, synced_at: datetime | None = None) -> LastfmArtist:
    return LastfmArtist(
        id=uuid.uuid7(),
        artist_id=uuid.uuid7(),
        name=name,
        name_key=name_key(name),
        similar_synced_at=synced_at,
    )


async def test_refresh_replaces_edges_and_stamps_freshness() -> None:
    seed = make_seed("Autechre")
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_similar_artists.return_value = [
        LastfmSimilarArtistData(name="Boards of Canada", mbid="mbid-boc", match=0.9),
        LastfmSimilarArtistData(name="boards of canada", mbid=None, match=0.8),
    ]

    synced, failed = await _refresh_seed_edges(session, lastfm, [seed], NOW)

    assert (synced, failed) == (1, 0)
    session.execute.assert_awaited_once()  # the delete of the seed's old edges
    edges = added_objects(session, LastfmSimilarArtist)
    assert [(e.name, e.match) for e in edges] == [("Boards of Canada", 0.9)]  # deduped, first wins
    assert edges[0].artist_id == seed.artist_id
    assert seed.similar_synced_at == NOW


async def test_refresh_treats_unknown_artist_as_durable_empty() -> None:
    seed = make_seed("Obscure")
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_similar_artists.side_effect = LastfmArtistNotFoundError("Obscure")

    synced, failed = await _refresh_seed_edges(session, lastfm, [seed], NOW)

    assert (synced, failed) == (1, 0)
    assert seed.similar_synced_at == NOW
    session.add.assert_not_called()


async def test_refresh_leaves_timestamp_untouched_on_failure() -> None:
    failing = make_seed("Failing")
    healthy = make_seed("Healthy")
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_similar_artists.side_effect = [
        LastfmApiError(8, "Operation failed"),
        [],
    ]

    synced, failed = await _refresh_seed_edges(session, lastfm, [failing, healthy], NOW)

    assert (synced, failed) == (1, 1)
    assert failing.similar_synced_at is None
    assert healthy.similar_synced_at == NOW


def make_account() -> LastfmAccount:
    return LastfmAccount(id=uuid.uuid7(), username="rj")


async def test_sync_creates_suggestions_from_cached_edges() -> None:
    seed = make_seed("Autechre", synced_at=datetime.now(UTC))
    seed_interest = interest(TOP_ARTIST_KIND, 100.0, artist_id=seed.artist_id)
    session = make_session()
    session.get.return_value = MagicMock(id=USER_ID, city_id=None, include_known_artists=False)
    session.execute.side_effect = [
        result_returning(make_account()),
        result_with_scalars([seed_interest]),  # interests
        result_with_scalars([]),  # exclusions
        result_with_scalars([seed]),  # seed lastfm rows (fresh: no fetch)
        result_with_scalars([edge(seed.artist_id, "Boards of Canada", 0.9)]),  # edges
        result_with_rows([]),  # canonical ids for candidate keys
        result_with_scalars([]),  # upsert: no existing lastfm rows
        result_with_rows([]),  # upsert: insert conflicts
        result_with_scalars([]),  # reconcile: no existing suggestion interests
    ]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_top_artists.return_value = [
        LastfmTopArtist(name="Autechre", url=None, mbid=None, playcount=100, rank=1)
    ]

    response = await request("POST", SYNC_URL, session, lastfm)

    assert response.status_code == 200
    body = response.json()
    assert body["seeds_total"] == 1
    assert body["seeds_skipped"] == 1
    assert body["candidates_scored"] == 1
    assert body["suggestions_created"] == 1
    assert (body["suggestions_kept"], body["suggestions_removed"]) == (0, 0)
    lastfm.get_similar_artists.assert_not_awaited()
    lastfm.get_top_artists.assert_awaited_once_with("rj", period="overall", limit=1000)
    assert [artist.name for artist in added_objects(session, Artist)] == ["Boards of Canada"]
    suggestion = added_objects(session, UserArtistInterest)[0]
    assert suggestion.kind == SIMILAR_ARTIST_KIND
    assert suggestion.source == "internal"
    assert suggestion.weight == 0.9
    assert suggestion.evidence["score"] == 0.9
    assert suggestion.evidence["paths"] == [
        {"seed_artist_id": str(seed.artist_id), "seed_name": "Autechre", "match": 0.9}
    ]


async def test_sync_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("POST", SYNC_URL, session, AsyncMock(spec=LastfmClient))

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"
