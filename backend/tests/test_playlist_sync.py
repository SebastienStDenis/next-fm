import uuid
from datetime import UTC, datetime, timedelta
from itertools import permutations
from unittest.mock import AsyncMock, call

from sqlalchemy.dialects import postgresql

from app.lastfm import LastfmArtistNotFoundError, LastfmArtistTopTrack, LastfmClient
from app.models import Artist, ArtistTopTrack, LastfmArtist, Playlist, SpotifyArtist
from app.musicbrainz import MusicBrainzApiError, MusicBrainzClient
from app.playlist_sync import (
    MATCH_EXACT,
    MATCH_FUZZY,
    PLAYLIST_MAX_TRACKS,
    TOP_TRACKS_FETCH_LIMIT,
    TOP_TRACKS_PER_ARTIST,
    ArtistMatch,
    _refresh_top_tracks,
    _resolve_artist,
    _write_deltas,
    desired_tracks,
    plan_insertions,
    plan_moves,
    playlist_description,
    playlist_title,
)
from app.spotify import SpotifyApiError, SpotifyArtistData, SpotifyClient, SpotifyTrackData
from tests.helpers import added_objects, make_session, result_returning

FIRST_SHOW = datetime(2026, 8, 1, 20, 0, tzinfo=UTC)


def make_match(artist_id: uuid.UUID, days: int = 0) -> ArtistMatch:
    return ArtistMatch(
        artist_id=artist_id, event_id=uuid.uuid7(), starts_at=FIRST_SHOW + timedelta(days=days)
    )


def cached_track(artist_id: uuid.UUID, track_id: str, rank: int) -> ArtistTopTrack:
    return ArtistTopTrack(
        artist_id=artist_id, rank=rank, title=f"Track {rank}", spotify_track_id=track_id
    )


def test_desired_tracks_orders_by_soonest_show_then_rank() -> None:
    soon, later = uuid.uuid7(), uuid.uuid7()
    matches = [make_match(soon, days=0), make_match(later, days=3)]
    top_tracks = {
        later: [cached_track(later, "l1", 1), cached_track(later, "l2", 2)],
        soon: [cached_track(soon, "s1", 1), cached_track(soon, "s2", 2)],
    }

    desired = desired_tracks(matches, top_tracks)

    assert [track.spotify_track_id for track in desired] == ["s1", "s2", "l1", "l2"]
    assert desired[0].artist_id == soon
    assert desired[0].event_id == matches[0].event_id
    assert desired[2].event_id == matches[1].event_id


def test_desired_tracks_caps_tracks_per_artist() -> None:
    artist_id = uuid.uuid7()
    tracks = [cached_track(artist_id, f"t{rank}", rank) for rank in range(1, 8)]

    desired = desired_tracks([make_match(artist_id)], {artist_id: tracks})

    assert [track.spotify_track_id for track in desired] == ["t1", "t2", "t3", "t4", "t5"]
    assert len(desired) == TOP_TRACKS_PER_ARTIST


def test_desired_tracks_dedupes_uris_keeping_soonest_artist() -> None:
    soon, later = uuid.uuid7(), uuid.uuid7()
    matches = [make_match(soon, days=0), make_match(later, days=3)]
    top_tracks = {
        soon: [cached_track(soon, "shared", 1)],
        later: [cached_track(later, "shared", 1), cached_track(later, "l2", 2)],
    }

    desired = desired_tracks(matches, top_tracks)

    assert [track.spotify_track_id for track in desired] == ["shared", "l2"]
    assert desired[0].artist_id == soon
    assert desired[0].event_id == matches[0].event_id


def test_desired_tracks_truncates_to_playlist_cap() -> None:
    matches = []
    top_tracks = {}
    for artist in range(21):
        artist_id = uuid.uuid7()
        matches.append(make_match(artist_id, days=artist))
        top_tracks[artist_id] = [
            cached_track(artist_id, f"a{artist}-t{rank}", rank) for rank in range(1, 6)
        ]

    desired = desired_tracks(matches, top_tracks)

    assert len(desired) == PLAYLIST_MAX_TRACKS
    assert desired[-1].spotify_track_id == "a19-t5"


def test_desired_tracks_skips_artists_without_cached_tracks() -> None:
    cached, uncached = uuid.uuid7(), uuid.uuid7()
    matches = [make_match(uncached, days=0), make_match(cached, days=1)]

    desired = desired_tracks(matches, {cached: [cached_track(cached, "c1", 1)]})

    assert [track.spotify_track_id for track in desired] == ["c1"]


def test_desired_tracks_empty_when_no_matches() -> None:
    assert desired_tracks([], {}) == []


def replay_moves(current: list[str], moves: list[tuple[int, int]]) -> list[str]:
    work = list(current)
    for range_start, insert_before in moves:
        work.insert(insert_before, work.pop(range_start))
    return work


def test_plan_moves_no_ops_when_relative_order_matches() -> None:
    assert plan_moves(["a", "c"], ["a", "b", "c"]) == []


def test_plan_moves_sorts_every_permutation() -> None:
    desired = ["a", "b", "c", "d"]
    for current in permutations(desired):
        moves = plan_moves(list(current), desired)

        assert replay_moves(list(current), moves) == desired


def test_plan_moves_sorts_survivor_subset() -> None:
    current = ["d", "a", "c"]
    desired = ["a", "b", "c", "d"]

    moves = plan_moves(current, desired)

    assert replay_moves(current, moves) == ["a", "c", "d"]


def test_plan_moves_single_element_and_empty() -> None:
    assert plan_moves(["a"], ["a"]) == []
    assert plan_moves([], ["a", "b"]) == []


def test_plan_insertions_all_new_is_one_run_at_zero() -> None:
    assert plan_insertions(["a", "b", "c"], set()) == [(0, ["a", "b", "c"])]


def test_plan_insertions_places_runs_around_survivors() -> None:
    desired = ["n0", "s1", "n1", "n2", "s2", "n3"]

    runs = plan_insertions(desired, {"s1", "s2"})

    assert runs == [(0, ["n0"]), (2, ["n1", "n2"]), (5, ["n3"])]


def test_plan_insertions_empty_when_everything_survives() -> None:
    assert plan_insertions(["a", "b"], {"a", "b"}) == []


def test_playlist_title_with_and_without_city() -> None:
    assert playlist_title("Alice", "Montréal") == "Alice's shows in Montréal"
    assert playlist_title("Alice", None) == "Alice's shows"


def test_playlist_description_formats_month_and_year() -> None:
    now = datetime(2026, 7, 6, 12, 0, tzinfo=UTC)

    description = playlist_description("Montréal", now)

    assert description == "Artists you love playing near Montréal. Updated July 2026."


def make_spotify_row(
    confidence: str = MATCH_EXACT, synced_at: datetime | None = None
) -> SpotifyArtist:
    return SpotifyArtist(
        id=uuid.uuid7(),
        artist_id=uuid.uuid7(),
        spotify_id="sp-metallica",
        name="Metallica",
        match_confidence=confidence,
        top_tracks_synced_at=synced_at,
    )


def lastfm_track(title: str, rank: int | None) -> LastfmArtistTopTrack:
    return LastfmArtistTopTrack(title=title, rank=rank, playcount=1000)


def spotify_track(track_id: str, artist_spotify_id: str) -> SpotifyTrackData:
    return SpotifyTrackData(
        id=track_id, name="Song", artists=[SpotifyArtistData(id=artist_spotify_id, name="X")]
    )


async def test_refresh_skips_fuzzy_and_fresh_rows() -> None:
    fuzzy = make_spotify_row(confidence=MATCH_FUZZY)
    fresh = make_spotify_row(synced_at=datetime.now(UTC) - timedelta(days=1))
    session = make_session()
    spotify = AsyncMock(spec=SpotifyClient)
    lastfm = AsyncMock(spec=LastfmClient)

    refreshed = await _refresh_top_tracks(session, spotify, lastfm, [fuzzy, fresh])

    assert refreshed == 0
    lastfm.get_artist_top_tracks.assert_not_awaited()
    session.execute.assert_not_awaited()


async def test_refresh_replaces_stale_cache_with_verified_tracks() -> None:
    row = make_spotify_row(synced_at=datetime.now(UTC) - timedelta(days=31))
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_artist_top_tracks.return_value = [
        lastfm_track("One", 1),
        lastfm_track("Two", 2),
        lastfm_track("Three", None),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_tracks.side_effect = [
        [spotify_track("imposter", "sp-other"), spotify_track("t1", row.spotify_id)],
        [spotify_track("t2", row.spotify_id)],
        [spotify_track("t3", row.spotify_id)],
    ]

    refreshed = await _refresh_top_tracks(session, spotify, lastfm, [row])

    assert refreshed == 1
    lastfm.get_artist_top_tracks.assert_awaited_once_with("Metallica", limit=TOP_TRACKS_FETCH_LIMIT)
    session.execute.assert_awaited_once()
    cached = added_objects(session, ArtistTopTrack)
    assert [(track.spotify_track_id, track.rank, track.title) for track in cached] == [
        ("t1", 1, "One"),
        ("t2", 2, "Two"),
        ("t3", 3, "Three"),
    ]
    assert all(track.artist_id == row.artist_id for track in cached)
    assert row.top_tracks_synced_at is not None
    assert row.top_tracks_synced_at > datetime.now(UTC) - timedelta(minutes=1)


async def test_refresh_stops_at_per_artist_cap() -> None:
    row = make_spotify_row()
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_artist_top_tracks.return_value = [
        lastfm_track(f"Song {rank}", rank) for rank in range(1, 8)
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_tracks.side_effect = [
        [spotify_track(f"t{rank}", row.spotify_id)] for rank in range(1, 8)
    ]

    await _refresh_top_tracks(session, spotify, lastfm, [row])

    assert spotify.search_tracks.await_count == TOP_TRACKS_PER_ARTIST
    assert len(added_objects(session, ArtistTopTrack)) == TOP_TRACKS_PER_ARTIST


async def test_refresh_skips_duplicate_and_unverified_candidates() -> None:
    row = make_spotify_row()
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_artist_top_tracks.return_value = [
        lastfm_track("One", 1),
        lastfm_track("One (Live)", 2),
        lastfm_track("Cover", 3),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_tracks.side_effect = [
        [spotify_track("t1", row.spotify_id)],
        [spotify_track("t1", row.spotify_id)],
        [spotify_track("imposter", "sp-other")],
    ]

    refreshed = await _refresh_top_tracks(session, spotify, lastfm, [row])

    assert refreshed == 1
    assert [track.spotify_track_id for track in added_objects(session, ArtistTopTrack)] == ["t1"]


async def test_refresh_leaves_timestamp_untouched_on_spotify_error() -> None:
    row = make_spotify_row()
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_artist_top_tracks.return_value = [lastfm_track("One", 1)]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_tracks.side_effect = SpotifyApiError(500, "boom")

    refreshed = await _refresh_top_tracks(session, spotify, lastfm, [row])

    assert refreshed == 0
    assert row.top_tracks_synced_at is None
    session.execute.assert_not_awaited()
    session.add.assert_not_called()


async def test_refresh_stamps_empty_cache_when_lastfm_artist_unknown() -> None:
    row = make_spotify_row()
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_artist_top_tracks.side_effect = LastfmArtistNotFoundError("Metallica")
    spotify = AsyncMock(spec=SpotifyClient)

    refreshed = await _refresh_top_tracks(session, spotify, lastfm, [row])

    assert refreshed == 1
    session.execute.assert_awaited_once()
    session.add.assert_not_called()
    assert row.top_tracks_synced_at is not None


def insert_values(session: AsyncMock) -> dict:
    statement = session.execute.await_args_list[0].args[0]
    return statement.compile(dialect=postgresql.dialect()).params


def make_lastfm_row(artist: Artist, mbid: str | None = None) -> LastfmArtist:
    return LastfmArtist(
        artist_id=artist.id, name=artist.name, name_key=artist.name.casefold(), mbid=mbid
    )


async def test_resolve_artist_uses_mbid_link_as_exact() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    stored = make_spotify_row()
    session = make_session()
    session.execute.side_effect = [result_returning(uuid.uuid7()), result_returning(stored)]
    musicbrainz = AsyncMock(spec=MusicBrainzClient)
    musicbrainz.get_artist_spotify_id.return_value = "sp-metallica"
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.get_artist.return_value = SpotifyArtistData(id="sp-metallica", name="Metallica")

    resolved = await _resolve_artist(
        session, spotify, musicbrainz, artist, make_lastfm_row(artist, mbid="mbid-1")
    )

    assert resolved is stored
    musicbrainz.get_artist_spotify_id.assert_awaited_once_with("mbid-1")
    spotify.search_artists.assert_not_awaited()
    values = insert_values(session)
    assert values["artist_id"] == artist.id
    assert values["spotify_id"] == "sp-metallica"
    assert values["match_confidence"] == MATCH_EXACT


async def test_resolve_artist_falls_back_to_search_when_mbid_lookup_fails() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    stored = make_spotify_row()
    session = make_session()
    session.execute.side_effect = [result_returning(uuid.uuid7()), result_returning(stored)]
    musicbrainz = AsyncMock(spec=MusicBrainzClient)
    musicbrainz.get_artist_spotify_id.side_effect = MusicBrainzApiError(503, "down")
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_artists.return_value = [SpotifyArtistData(id="sp-metallica", name="Metallica")]

    resolved = await _resolve_artist(
        session, spotify, musicbrainz, artist, make_lastfm_row(artist, mbid="mbid-1")
    )

    assert resolved is stored
    spotify.search_artists.assert_awaited_once_with("Metallica")
    assert insert_values(session)["match_confidence"] == MATCH_EXACT


async def test_resolve_artist_matches_name_case_insensitively() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    stored = make_spotify_row()
    session = make_session()
    session.execute.side_effect = [result_returning(uuid.uuid7()), result_returning(stored)]
    musicbrainz = AsyncMock(spec=MusicBrainzClient)
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_artists.return_value = [
        SpotifyArtistData(id="sp-tribute", name="Metallica Tribute"),
        SpotifyArtistData(id="sp-metallica", name="mETALLICA"),
    ]

    resolved = await _resolve_artist(session, spotify, musicbrainz, artist, None)

    assert resolved is stored
    musicbrainz.get_artist_spotify_id.assert_not_awaited()
    values = insert_values(session)
    assert values["spotify_id"] == "sp-metallica"
    assert values["match_confidence"] == MATCH_EXACT


async def test_resolve_artist_stores_first_result_as_fuzzy_without_exact_match() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    stored = make_spotify_row(confidence=MATCH_FUZZY)
    session = make_session()
    session.execute.side_effect = [result_returning(uuid.uuid7()), result_returning(stored)]
    musicbrainz = AsyncMock(spec=MusicBrainzClient)
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_artists.return_value = [
        SpotifyArtistData(id="sp-tribute", name="Metallica Tribute"),
        SpotifyArtistData(id="sp-cover", name="Metallica Covers"),
    ]

    resolved = await _resolve_artist(session, spotify, musicbrainz, artist, None)

    assert resolved is stored
    values = insert_values(session)
    assert values["spotify_id"] == "sp-tribute"
    assert values["match_confidence"] == MATCH_FUZZY


async def test_resolve_artist_returns_none_without_search_results() -> None:
    artist = Artist(id=uuid.uuid7(), name="Obscure Basement Band")
    session = make_session()
    musicbrainz = AsyncMock(spec=MusicBrainzClient)
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_artists.return_value = []

    resolved = await _resolve_artist(session, spotify, musicbrainz, artist, None)

    assert resolved is None
    session.execute.assert_not_awaited()


def make_playlist(snapshot: str | None = "snap-0") -> Playlist:
    return Playlist(
        id=uuid.uuid7(),
        user_id=uuid.uuid7(),
        kind="city_shows",
        name="Shows",
        snapshot_id=snapshot,
    )


async def test_write_deltas_pushes_removals_moves_and_additions() -> None:
    playlist = make_playlist()
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.remove_playlist_items.return_value = "snap-1"
    spotify.reorder_playlist_items.return_value = "snap-2"
    spotify.add_playlist_items.side_effect = ["snap-3", "snap-4"]
    current = ["a", "x", "b", "y"]
    desired = ["b", "n1", "a", "n2"]

    added, removed, moved = await _write_deltas(spotify, playlist, "pl-1", current, desired)

    assert (added, removed, moved) == (2, 2, 1)
    spotify.remove_playlist_items.assert_awaited_once_with(
        "pl-1", ["spotify:track:x", "spotify:track:y"]
    )
    assert spotify.reorder_playlist_items.await_args_list == [call("pl-1", 1, 0)]
    assert spotify.add_playlist_items.await_args_list == [
        call("pl-1", ["spotify:track:n1"], position=1),
        call("pl-1", ["spotify:track:n2"], position=3),
    ]
    assert playlist.snapshot_id == "snap-4"


async def test_write_deltas_batches_removals() -> None:
    playlist = make_playlist()
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.remove_playlist_items.side_effect = ["snap-1", "snap-2"]
    current = [f"c{index:03}" for index in range(101)]

    added, removed, moved = await _write_deltas(spotify, playlist, "pl-1", current, [])

    assert (added, removed, moved) == (0, 101, 0)
    batches = [awaited.args[1] for awaited in spotify.remove_playlist_items.await_args_list]
    assert [len(batch) for batch in batches] == [100, 1]
    assert playlist.snapshot_id == "snap-2"


async def test_write_deltas_makes_no_remote_calls_when_in_sync() -> None:
    playlist = make_playlist()
    spotify = AsyncMock(spec=SpotifyClient)
    current = ["a", "b", "c"]

    added, removed, moved = await _write_deltas(spotify, playlist, "pl-1", current, current)

    assert (added, removed, moved) == (0, 0, 0)
    spotify.remove_playlist_items.assert_not_awaited()
    spotify.reorder_playlist_items.assert_not_awaited()
    spotify.add_playlist_items.assert_not_awaited()
    assert playlist.snapshot_id == "snap-0"
