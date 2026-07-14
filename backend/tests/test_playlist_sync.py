import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import httpx
from sqlalchemy.dialects import postgresql

from app.lastfm import (
    LastfmApiError,
    LastfmArtistNotFoundError,
    LastfmArtistTopTrack,
    LastfmClient,
)
from app.matching import ArtistMatch
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
from app.playlist_sync import (
    AUDIT_CONFIRMATION_AGE,
    MATCH_EXACT,
    MATCH_FUZZY,
    PLAYLIST_MAX_TRACKS,
    TOMBSTONE_SOURCE_AUDIT,
    TOMBSTONE_SOURCE_DELETE,
    TOP_TRACKS_FETCH_LIMIT,
    TOP_TRACKS_PER_ARTIST,
    _empty_playlist,
    _refresh_top_tracks,
    _resolve_artist,
    _sync_playlist,
    audit_bot_playlists,
    desired_tracks,
    drain_playlist_tombstones,
    playlist_description,
    playlist_title,
    settle_tombstone,
)
from app.spotify import (
    SpotifyApiError,
    SpotifyArtistData,
    SpotifyClient,
    SpotifyPlaylistData,
    SpotifyTrackData,
)
from tests.helpers import added_objects, make_session, result_returning, result_with_scalars

FIRST_CONCERT = datetime(2026, 8, 1, 20, 0, tzinfo=UTC)


def make_match(artist_id: uuid.UUID, days: int = 0) -> ArtistMatch:
    return ArtistMatch(
        artist_id=artist_id, event_id=uuid.uuid7(), starts_at=FIRST_CONCERT + timedelta(days=days)
    )


def cached_track(artist_id: uuid.UUID, track_id: str, rank: int) -> ArtistTopTrack:
    return ArtistTopTrack(
        artist_id=artist_id, rank=rank, title=f"Track {rank}", spotify_track_id=track_id
    )


def test_desired_tracks_orders_by_soonest_concert_then_rank() -> None:
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

    assert [track.spotify_track_id for track in desired] == ["t1", "t2", "t3"]
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
    for artist in range(35):
        artist_id = uuid.uuid7()
        matches.append(make_match(artist_id, days=artist))
        top_tracks[artist_id] = [
            cached_track(artist_id, f"a{artist}-t{rank}", rank) for rank in range(1, 4)
        ]

    desired = desired_tracks(matches, top_tracks)

    assert len(desired) == PLAYLIST_MAX_TRACKS
    assert desired[-1].spotify_track_id == "a33-t1"


def test_desired_tracks_skips_artists_without_cached_tracks() -> None:
    cached, uncached = uuid.uuid7(), uuid.uuid7()
    matches = [make_match(uncached, days=0), make_match(cached, days=1)]

    desired = desired_tracks(matches, {cached: [cached_track(cached, "c1", 1)]})

    assert [track.spotify_track_id for track in desired] == ["c1"]


def test_desired_tracks_empty_when_no_matches() -> None:
    assert desired_tracks([], {}) == []


def test_playlist_title_with_and_without_city() -> None:
    assert playlist_title("Alice", "Montréal") == "Alice's concerts in Montréal"
    assert playlist_title("Alice", None) == "Alice's concerts"


def test_playlist_title_possessive_for_name_ending_in_s() -> None:
    assert playlist_title("Charles", "Montréal") == "Charles' concerts in Montréal"
    assert playlist_title("Charles", None) == "Charles' concerts"


def test_playlist_description() -> None:
    now = datetime(2026, 7, 6, 12, 0, tzinfo=UTC)

    assert playlist_description("Alice", "Montréal", now) == (
        "Artists you might like playing near Montréal, curated for Alice by "
        "NextFM (nextfm.sebastienstdenis.me). Updated July 6, 2026."
    )


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
        id=track_id, name="Track", artists=[SpotifyArtistData(id=artist_spotify_id, name="X")]
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
        lastfm_track(f"Track {rank}", rank) for rank in range(1, 8)
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


async def test_refresh_skips_artist_on_lastfm_error_without_aborting_sync() -> None:
    failing = make_spotify_row()
    healthy = make_spotify_row()
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_artist_top_tracks.side_effect = [
        LastfmApiError(8, "Operation failed"),
        [lastfm_track("One", 1)],
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.search_tracks.return_value = [spotify_track("t1", healthy.spotify_id)]

    refreshed = await _refresh_top_tracks(session, spotify, lastfm, [failing, healthy])

    assert refreshed == 1
    assert failing.top_tracks_synced_at is None
    assert healthy.top_tracks_synced_at is not None


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
    return executed_params(session, 0)


def executed_params(session: AsyncMock, index: int) -> dict:
    statement = session.execute.await_args_list[index].args[0]
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


SYNC_NOW = datetime(2026, 7, 6, 12, 0, tzinfo=UTC)


def make_playlist(spotify_playlist_id: str | None = "pl-1") -> Playlist:
    return Playlist(
        id=uuid.uuid7(),
        user_id=uuid.uuid7(),
        kind="city_concerts",
        name=playlist_title("Alice", "Montréal"),
        description=playlist_description("Alice", "Montréal", SYNC_NOW),
        spotify_playlist_id=spotify_playlist_id,
        snapshot_id="snap-0",
    )


def local_row(playlist: Playlist, track: ArtistTopTrack, event_id: uuid.UUID) -> PlaylistTrack:
    return PlaylistTrack(
        playlist_id=playlist.id,
        position=0,
        spotify_track_id=track.spotify_track_id,
        artist_id=track.artist_id,
        event_id=event_id,
    )


async def run_sync_playlist(
    session: AsyncMock, spotify: AsyncMock, playlist: Playlist, matches: list[ArtistMatch]
):
    return await _sync_playlist(
        session,
        spotify,
        playlist,
        User(id=playlist.user_id, name="Alice", include_known_artists=False),
        City(geonameid=6077243, name="Montréal"),
        matches,
        SYNC_NOW,
    )


async def test_sync_playlist_replaces_remote_and_rewrites_changed_local_rows() -> None:
    playlist = make_playlist()
    match = make_match(uuid.uuid7())
    cached = [cached_track(match.artist_id, "t1", 1), cached_track(match.artist_id, "t2", 2)]
    stale = local_row(playlist, cached_track(uuid.uuid7(), "old", 1), uuid.uuid7())
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars(cached),
        result_with_scalars([stale]),
        MagicMock(),  # delete of the stale playlist_tracks rows
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.replace_playlist_items.return_value = "snap-1"

    item = await run_sync_playlist(session, spotify, playlist, [match])

    spotify.replace_playlist_items.assert_awaited_once_with(
        "pl-1", ["spotify:track:t1", "spotify:track:t2"]
    )
    spotify.create_playlist.assert_not_awaited()
    assert playlist.snapshot_id == "snap-1"
    assert session.execute.await_count == 3
    rewritten = [
        (row.position, row.spotify_track_id, row.artist_id, row.event_id)
        for row in added_objects(session, PlaylistTrack)
    ]
    assert rewritten == [
        (0, "t1", match.artist_id, match.event_id),
        (1, "t2", match.artist_id, match.event_id),
    ]
    assert item.status == "synced"
    assert item.created_remotely is False
    assert (item.tracks_added, item.tracks_removed, item.tracks_total) == (2, 1, 2)
    assert playlist.last_synced_at == SYNC_NOW


async def test_sync_playlist_skips_replace_when_tracklist_unchanged() -> None:
    playlist = make_playlist()
    match = make_match(uuid.uuid7())
    cached = cached_track(match.artist_id, "t1", 1)
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([cached]),
        result_with_scalars([local_row(playlist, cached, match.event_id)]),
    ]
    spotify = AsyncMock(spec=SpotifyClient)

    item = await run_sync_playlist(session, spotify, playlist, [match])

    spotify.replace_playlist_items.assert_not_awaited()
    assert playlist.snapshot_id == "snap-0"
    assert session.execute.await_count == 2  # no delete: local rows already match
    session.add.assert_not_called()
    assert (item.tracks_added, item.tracks_removed, item.tracks_total) == (0, 0, 1)
    assert playlist.last_synced_at == SYNC_NOW


async def test_sync_playlist_replaces_remote_when_only_order_changed() -> None:
    playlist = make_playlist()
    match = make_match(uuid.uuid7())
    cached = [cached_track(match.artist_id, "t1", 1), cached_track(match.artist_id, "t2", 2)]
    reordered = [
        local_row(playlist, cached[1], match.event_id),
        local_row(playlist, cached[0], match.event_id),
    ]
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars(cached),
        result_with_scalars(reordered),
        MagicMock(),  # delete of the stale playlist_tracks rows
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.replace_playlist_items.return_value = "snap-1"

    item = await run_sync_playlist(session, spotify, playlist, [match])

    spotify.replace_playlist_items.assert_awaited_once_with(
        "pl-1", ["spotify:track:t1", "spotify:track:t2"]
    )
    assert [row.spotify_track_id for row in added_objects(session, PlaylistTrack)] == ["t1", "t2"]
    assert (item.tracks_added, item.tracks_removed, item.tracks_total) == (0, 0, 2)


async def test_sync_playlist_keeps_snapshot_when_replace_returns_none() -> None:
    playlist = make_playlist()
    match = make_match(uuid.uuid7())
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([cached_track(match.artist_id, "t1", 1)]),
        result_with_scalars([]),
        MagicMock(),  # delete of the stale playlist_tracks rows
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.replace_playlist_items.return_value = None

    await run_sync_playlist(session, spotify, playlist, [match])

    spotify.replace_playlist_items.assert_awaited_once_with("pl-1", ["spotify:track:t1"])
    assert playlist.snapshot_id == "snap-0"  # kept when Spotify omits the new snapshot


async def test_sync_playlist_rewrites_local_rows_without_replace_when_only_event_changed() -> None:
    playlist = make_playlist()
    match = make_match(uuid.uuid7())
    cached = cached_track(match.artist_id, "t1", 1)
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([cached]),
        result_with_scalars([local_row(playlist, cached, uuid.uuid7())]),
        MagicMock(),  # delete of the stale playlist_tracks rows
    ]
    spotify = AsyncMock(spec=SpotifyClient)

    item = await run_sync_playlist(session, spotify, playlist, [match])

    spotify.replace_playlist_items.assert_not_awaited()
    assert [row.event_id for row in added_objects(session, PlaylistTrack)] == [match.event_id]
    assert (item.tracks_added, item.tracks_removed, item.tracks_total) == (0, 0, 1)


async def test_sync_playlist_skips_replace_for_fresh_empty_playlist() -> None:
    playlist = make_playlist(spotify_playlist_id=None)
    session = make_session()
    session.execute.side_effect = [
        result_returning(playlist.id),  # the claim on the new remote id
        result_with_scalars([]),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.create_playlist.return_value = SpotifyPlaylistData(
        id="pl-new", url="https://open.spotify.com/playlist/pl-new", snapshot_id="snap-new"
    )

    item = await run_sync_playlist(session, spotify, playlist, [])

    spotify.create_playlist.assert_awaited_once_with(
        playlist_title("Alice", "Montréal"),
        playlist_description("Alice", "Montréal", SYNC_NOW),
    )
    spotify.replace_playlist_items.assert_not_awaited()
    session.commit.assert_awaited_once()  # the remote id is persisted right after creation
    claim = executed_params(session, 0)
    assert claim["spotify_playlist_id"] == "pl-new"
    assert claim["snapshot_id"] == "snap-new"
    session.add.assert_not_called()
    assert item.created_remotely is True
    assert (item.tracks_added, item.tracks_removed, item.tracks_total) == (0, 0, 0)


async def test_sync_playlist_creates_then_replaces_when_fresh_with_tracks() -> None:
    playlist = make_playlist(spotify_playlist_id=None)
    match = make_match(uuid.uuid7())
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([cached_track(match.artist_id, "t1", 1)]),
        result_returning(playlist.id),  # the claim on the new remote id
        result_with_scalars([]),
        MagicMock(),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.create_playlist.return_value = SpotifyPlaylistData(
        id="pl-new", url=None, snapshot_id="snap-new"
    )
    spotify.replace_playlist_items.return_value = "snap-1"

    item = await run_sync_playlist(session, spotify, playlist, [match])

    spotify.create_playlist.assert_awaited_once()
    spotify.replace_playlist_items.assert_awaited_once_with("pl-new", ["spotify:track:t1"])
    session.commit.assert_awaited_once()
    assert playlist.snapshot_id == "snap-1"
    assert [row.spotify_track_id for row in added_objects(session, PlaylistTrack)] == ["t1"]
    assert item.created_remotely is True
    assert (item.tracks_added, item.tracks_removed, item.tracks_total) == (1, 0, 1)


async def test_sync_playlist_lost_create_race_adopts_the_winner() -> None:
    playlist = make_playlist(spotify_playlist_id=None)
    winner = make_playlist(spotify_playlist_id="pl-winner")
    winner.id = playlist.id
    match = make_match(uuid.uuid7())
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([cached_track(match.artist_id, "t1", 1)]),
        result_returning(None),  # claim lost: a concurrent sync attached its own id
        MagicMock(),  # tombstone insert for our own creation
        MagicMock(),  # tombstone cleared once the unfollow lands
        result_returning(winner),  # re-read shows the winner's row
        result_with_scalars([]),
        MagicMock(),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.create_playlist.return_value = SpotifyPlaylistData(
        id="pl-new", url=None, snapshot_id="snap-new"
    )
    spotify.replace_playlist_items.return_value = "snap-1"

    item = await run_sync_playlist(session, spotify, playlist, [match])

    spotify.unfollow_playlist.assert_awaited_once_with("pl-new")  # own creation discarded
    spotify.replace_playlist_items.assert_awaited_once_with("pl-winner", ["spotify:track:t1"])
    assert item.status == "synced"
    assert item.created_remotely is False


async def test_sync_playlist_lost_race_to_deletion_discards_creation() -> None:
    playlist = make_playlist(spotify_playlist_id=None)
    session = make_session()
    session.execute.side_effect = [
        result_returning(None),  # claim lost: the row was deleted mid-sync
        MagicMock(),  # tombstone insert after the failed unfollow
        result_returning(None),  # re-read confirms the row is gone
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.create_playlist.return_value = SpotifyPlaylistData(
        id="pl-new", url=None, snapshot_id="snap-new"
    )
    spotify.unfollow_playlist.side_effect = SpotifyApiError(500, "boom")

    item = await run_sync_playlist(session, spotify, playlist, [])

    assert item.status == "deleted"
    spotify.replace_playlist_items.assert_not_awaited()
    tombstone = executed_params(session, 1)
    assert tombstone["spotify_playlist_id"] == "pl-new"
    assert tombstone["source"] == TOMBSTONE_SOURCE_DELETE


async def test_empty_playlist_clears_remote_and_local_rows() -> None:
    playlist = make_playlist()
    row = local_row(playlist, cached_track(uuid.uuid7(), "t1", 1), uuid.uuid7())
    session = make_session()
    session.execute.side_effect = [result_with_scalars([row]), MagicMock()]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.replace_playlist_items.return_value = "snap-empty"

    item = await _empty_playlist(session, spotify, playlist, SYNC_NOW)

    spotify.replace_playlist_items.assert_awaited_once_with("pl-1", [])
    assert playlist.snapshot_id == "snap-empty"
    assert playlist.last_synced_at == SYNC_NOW
    assert item.status == "no_city"
    assert item.tracks_removed == 1


async def test_empty_playlist_without_remote_playlist_touches_nothing() -> None:
    playlist = make_playlist(spotify_playlist_id=None)
    session = make_session()
    session.execute.side_effect = [result_with_scalars([])]
    spotify = AsyncMock(spec=SpotifyClient)

    item = await _empty_playlist(session, spotify, playlist, SYNC_NOW)

    spotify.replace_playlist_items.assert_not_awaited()
    assert item.status == "no_city"
    assert item.tracks_removed == 0


async def test_empty_playlist_already_empty_skips_the_remote_write() -> None:
    playlist = make_playlist()
    session = make_session()
    session.execute.side_effect = [result_with_scalars([])]
    spotify = AsyncMock(spec=SpotifyClient)

    item = await _empty_playlist(session, spotify, playlist, SYNC_NOW)

    spotify.replace_playlist_items.assert_not_awaited()
    assert item.tracks_removed == 0


async def test_empty_playlist_tolerates_vanished_remote_playlist() -> None:
    playlist = make_playlist()
    row = local_row(playlist, cached_track(uuid.uuid7(), "t1", 1), uuid.uuid7())
    session = make_session()
    session.execute.side_effect = [result_with_scalars([row]), MagicMock()]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.replace_playlist_items.side_effect = SpotifyApiError(404, "gone")

    item = await _empty_playlist(session, spotify, playlist, SYNC_NOW)

    assert item.tracks_removed == 1  # local rows still cleared
    assert session.execute.await_count == 2


def make_tombstone(
    spotify_playlist_id: str = "pl-dead",
    source: str = TOMBSTONE_SOURCE_DELETE,
    age: timedelta = timedelta(0),
) -> SpotifyPlaylistTombstone:
    return SpotifyPlaylistTombstone(
        id=uuid.uuid7(),
        spotify_playlist_id=spotify_playlist_id,
        source=source,
        created_at=datetime.now(UTC) - age,
    )


async def test_settle_tombstone_unfollows_and_clears() -> None:
    session = make_session()
    spotify = AsyncMock(spec=SpotifyClient)

    assert await settle_tombstone(session, spotify, "pl-dead") is True

    spotify.unfollow_playlist.assert_awaited_once_with("pl-dead")
    session.execute.assert_awaited_once()


async def test_settle_tombstone_treats_gone_playlist_as_settled() -> None:
    session = make_session()
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.unfollow_playlist.side_effect = SpotifyApiError(404, "not found")

    assert await settle_tombstone(session, spotify, "pl-dead") is True

    session.execute.assert_awaited_once()


async def test_settle_tombstone_keeps_tombstone_on_failure() -> None:
    session = make_session()
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.unfollow_playlist.side_effect = httpx.ConnectError("down")

    assert await settle_tombstone(session, spotify, "pl-dead") is False

    session.execute.assert_not_awaited()


async def test_drain_settles_delete_tombstones() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([make_tombstone()]),
        MagicMock(),  # tombstone cleared
    ]
    spotify = AsyncMock(spec=SpotifyClient)

    result = await drain_playlist_tombstones(session, spotify)

    spotify.unfollow_playlist.assert_awaited_once_with("pl-dead")
    assert (result.drained, result.pending) == (1, 0)


async def test_drain_reports_failed_unfollows_as_pending() -> None:
    session = make_session()
    session.execute.side_effect = [result_with_scalars([make_tombstone()])]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.unfollow_playlist.side_effect = SpotifyApiError(500, "boom")

    result = await drain_playlist_tombstones(session, spotify)

    assert (result.drained, result.pending) == (0, 1)


async def test_drain_leaves_young_audit_tombstones_alone() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([make_tombstone(source=TOMBSTONE_SOURCE_AUDIT)])
    ]
    spotify = AsyncMock(spec=SpotifyClient)

    result = await drain_playlist_tombstones(session, spotify)

    spotify.unfollow_playlist.assert_not_awaited()
    assert (result.drained, result.pending) == (0, 1)


async def test_drain_unfollows_confirmed_audit_tombstones() -> None:
    aged = make_tombstone(source=TOMBSTONE_SOURCE_AUDIT, age=AUDIT_CONFIRMATION_AGE * 2)
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([aged]),
        result_returning(None),  # still unclaimed by any playlists row
        MagicMock(),  # tombstone cleared
    ]
    spotify = AsyncMock(spec=SpotifyClient)

    result = await drain_playlist_tombstones(session, spotify)

    spotify.unfollow_playlist.assert_awaited_once_with("pl-dead")
    assert (result.drained, result.pending) == (1, 0)


async def test_drain_drops_audit_tombstone_claimed_since_the_audit() -> None:
    aged = make_tombstone(source=TOMBSTONE_SOURCE_AUDIT, age=AUDIT_CONFIRMATION_AGE * 2)
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([aged]),
        result_returning(uuid.uuid7()),  # a playlists row claimed the id: not an orphan
    ]
    spotify = AsyncMock(spec=SpotifyClient)

    result = await drain_playlist_tombstones(session, spotify)

    spotify.unfollow_playlist.assert_not_awaited()
    session.delete.assert_awaited_once_with(aged)
    assert (result.drained, result.pending) == (1, 0)


async def test_audit_records_unknown_remote_ids() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars(["pl-known"]),  # claimed by playlists rows
        result_with_scalars(["pl-tombstoned"]),  # already awaiting unfollow
        MagicMock(),  # the audit tombstone insert
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.list_own_playlist_ids.return_value = ["pl-known", "pl-tombstoned", "pl-orphan"]

    found = await audit_bot_playlists(session, spotify)

    assert found == 1
    tombstone = executed_params(session, 2)
    assert tombstone["spotify_playlist_id"] == "pl-orphan"
    assert tombstone["source"] == TOMBSTONE_SOURCE_AUDIT


async def test_audit_with_clean_account_touches_nothing() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars(["pl-known"]),
        result_with_scalars([]),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.list_own_playlist_ids.return_value = ["pl-known"]

    found = await audit_bot_playlists(session, spotify)

    assert found == 0
    assert session.execute.await_count == 2
