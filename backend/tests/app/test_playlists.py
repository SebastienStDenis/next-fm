import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.clients.lastfm import LastfmClient
from app.clients.musicbrainz import MusicBrainzClient
from app.clients.spotify import SpotifyApiError, SpotifyClient, SpotifyPlaylistData
from app.core.config import Settings
from app.core.models import (
    Artist,
    ArtistTopTrack,
    City,
    Event,
    Playlist,
    PlaylistTrack,
    SpotifyArtist,
    User,
)
from app.sync.playlist_sync import PINNED_PLAYLIST_CAP
from tests.helpers import (
    added_objects,
    make_session,
    request,
    result_returning,
    result_with_rows,
    result_with_scalars,
)

USER_ID = uuid.uuid7()
PLAYLIST_ID = uuid.uuid7()
PLAYLISTS_URL = "/me/playlists"
SYNC_URL = f"{PLAYLISTS_URL}/sync"


def make_user() -> User:
    return User(id=USER_ID, name="Alice", city_id=6077243)


def make_city() -> City:
    return City(
        geonameid=6077243,
        name="Montréal",
        ascii_name="Montreal",
        admin1="Quebec",
        country_code="CA",
        latitude=45.50884,
        longitude=-73.58781,
        population=1600000,
    )


def make_matched_event() -> Event:
    return Event(
        id=uuid.uuid7(),
        title=None,
        venue_name="MTELUS",
        venue_latitude=45.51,
        venue_longitude=-73.56,
        city_name="Montreal",
        region="QC",
        country="Canada",
        starts_at=datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )


def make_playlist(**overrides) -> Playlist:
    fields = {
        "id": PLAYLIST_ID,
        "user_id": USER_ID,
        "kind": "city_concerts",
        "city_id": 6077243,
        "name": "Alice's concerts in Montréal",
        "spotify_playlist_id": "pl1",
    }
    fields.update(overrides)
    return Playlist(**fields)


def commit_assigning_ids(session: AsyncMock) -> None:
    async def commit() -> None:
        for call in session.add.call_args_list:
            obj = call.args[0]
            if obj.id is None:
                obj.id = uuid.uuid7()

    session.commit = AsyncMock(side_effect=commit)


async def test_list_playlists_includes_city_and_track_provenance() -> None:
    city = make_city()
    pinned = make_playlist()
    default = make_playlist(id=uuid.uuid7(), city_id=None, name="Alice's concerts")
    artist = Artist(id=uuid.uuid7(), name="Autechre")
    event = make_matched_event()
    track = PlaylistTrack(
        playlist_id=pinned.id,
        position=0,
        spotify_track_id="t1",
        artist_id=artist.id,
        event_id=event.id,
    )
    orphaned = PlaylistTrack(playlist_id=default.id, position=0, spotify_track_id="t2")
    session = make_session()
    session.execute.side_effect = [
        result_with_rows([(pinned, city), (default, None)]),
        result_with_rows(
            [
                (track, artist, event, "Gantz Graf", "https://tix.example/autechre"),
                (orphaned, None, None, None, None),
            ]
        ),
    ]

    response = await request("GET", PLAYLISTS_URL, session, user=make_user())

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert body[0]["name"] == "Alice's concerts in Montréal"
    assert body[0]["city"]["name"] == "Montréal"
    assert body[0]["spotify_playlist_id"] == "pl1"
    assert body[0]["tracks"] == [
        {
            "position": 0,
            "spotify_track_id": "t1",
            "title": "Gantz Graf",
            "artist": {"id": str(artist.id), "name": "Autechre"},
            "event": {
                "id": str(event.id),
                "title": None,
                "venue_name": "MTELUS",
                "venue_latitude": 45.51,
                "venue_longitude": -73.56,
                "city_name": "Montreal",
                "region": "QC",
                "country": "Canada",
                "starts_at": "2026-08-01T20:00:00Z",
            },
            "url": "https://tix.example/autechre",
        }
    ]
    assert body[1]["city"] is None
    assert body[1]["tracks"] == [
        {
            "position": 0,
            "spotify_track_id": "t2",
            "title": None,
            "artist": None,
            "event": None,
            "url": None,
        }
    ]


async def test_list_playlists_empty() -> None:
    session = make_session()
    session.execute.side_effect = [result_with_rows([])]

    response = await request("GET", PLAYLISTS_URL, session, user=make_user())

    assert response.status_code == 200
    assert response.json() == []
    assert session.execute.await_count == 1


async def test_list_playlists_requires_authentication() -> None:
    session = make_session()

    response = await request("GET", PLAYLISTS_URL, session)

    assert response.status_code == 401


async def test_create_pinned_playlist() -> None:
    city = make_city()
    session = make_session()
    session.get.return_value = city
    session.execute.side_effect = [result_with_scalars([])]
    commit_assigning_ids(session)

    response = await request(
        "POST", PLAYLISTS_URL, session, user=make_user(), json={"geonameid": 6077243}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "city_concerts"
    assert body["name"] == "Alice's concerts in Montréal"
    assert body["city"]["geonameid"] == 6077243
    assert body["spotify_playlist_id"] is None
    assert body["tracks"] == []
    playlists = added_objects(session, Playlist)
    assert len(playlists) == 1
    assert playlists[0].city_id == 6077243
    assert playlists[0].kind == "city_concerts"
    session.commit.assert_awaited_once()


async def test_create_pinned_playlist_unknown_city() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request(
        "POST", PLAYLISTS_URL, session, user=make_user(), json={"geonameid": 999}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "City not found"
    session.add.assert_not_called()


async def test_create_pinned_playlist_lost_race_is_conflict() -> None:
    session = make_session()
    session.get.return_value = make_city()
    session.execute.side_effect = [result_with_scalars([])]
    session.commit.side_effect = IntegrityError("stmt", {}, Exception("duplicate key"))

    response = await request(
        "POST", PLAYLISTS_URL, session, user=make_user(), json={"geonameid": 6077243}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A playlist for this city already exists"


async def test_create_pinned_playlist_duplicate_city() -> None:
    session = make_session()
    session.get.return_value = make_city()
    session.execute.side_effect = [result_with_scalars([make_playlist()])]

    response = await request(
        "POST", PLAYLISTS_URL, session, user=make_user(), json={"geonameid": 6077243}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A playlist for this city already exists"
    session.add.assert_not_called()


async def test_create_pinned_playlist_at_cap() -> None:
    pinned = [make_playlist(id=uuid.uuid7(), city_id=1000 + i) for i in range(PINNED_PLAYLIST_CAP)]
    session = make_session()
    session.get.return_value = make_city()
    session.execute.side_effect = [result_with_scalars(pinned)]

    response = await request(
        "POST", PLAYLISTS_URL, session, user=make_user(), json={"geonameid": 6077243}
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Pinned city limit reached"
    session.add.assert_not_called()


async def test_delete_playlist_unfollows_and_settles_tombstone() -> None:
    playlist = make_playlist()
    session = make_session()
    session.get.return_value = playlist
    spotify = AsyncMock(spec=SpotifyClient)

    response = await request(
        "DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, spotify=spotify, user=make_user()
    )

    assert response.status_code == 204
    session.delete.assert_awaited_once_with(playlist)
    spotify.unfollow_playlist.assert_awaited_once_with("pl1")
    session.execute.assert_awaited_once()  # tombstone cleared after the unfollow landed
    assert session.commit.await_count == 2  # the deletion, then the settled tombstone


async def test_delete_playlist_skips_unfollow_without_spotify_id() -> None:
    playlist = make_playlist(spotify_playlist_id=None)
    session = make_session()
    session.get.return_value = playlist
    spotify = AsyncMock(spec=SpotifyClient)

    response = await request(
        "DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, spotify=spotify, user=make_user()
    )

    assert response.status_code == 204
    spotify.unfollow_playlist.assert_not_awaited()
    session.delete.assert_awaited_once_with(playlist)
    session.commit.assert_awaited_once()


async def test_delete_playlist_tolerates_spotify_not_found() -> None:
    playlist = make_playlist()
    session = make_session()
    session.get.return_value = playlist
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.unfollow_playlist.side_effect = SpotifyApiError(404, "not found")

    response = await request(
        "DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, spotify=spotify, user=make_user()
    )

    assert response.status_code == 204
    session.delete.assert_awaited_once_with(playlist)
    assert session.commit.await_count == 2  # already gone remotely counts as settled


async def test_delete_playlist_survives_spotify_failure() -> None:
    playlist = make_playlist()
    session = make_session()
    session.get.return_value = playlist
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.unfollow_playlist.side_effect = SpotifyApiError(500, "boom")

    response = await request(
        "DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, spotify=spotify, user=make_user()
    )

    assert response.status_code == 204
    session.delete.assert_awaited_once_with(playlist)
    session.execute.assert_not_awaited()  # tombstone left for the nightly drainer
    session.commit.assert_awaited_once()


async def test_delete_playlist_survives_post_commit_db_failure() -> None:
    playlist = make_playlist()
    session = make_session()
    session.get.return_value = playlist
    session.execute.side_effect = Exception("connection lost")  # the tombstone cleanup
    spotify = AsyncMock(spec=SpotifyClient)

    response = await request(
        "DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, spotify=spotify, user=make_user()
    )

    assert response.status_code == 204  # the deletion committed; 204 is the truth
    session.delete.assert_awaited_once_with(playlist)


async def test_delete_playlist_without_spotify_configured() -> None:
    playlist = make_playlist()
    session = make_session()
    session.get.return_value = playlist

    response = await request("DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, user=make_user())

    assert response.status_code == 204
    session.delete.assert_awaited_once_with(playlist)
    session.commit.assert_awaited_once()


async def test_delete_playlist_of_another_user() -> None:
    playlist = make_playlist(user_id=uuid.uuid7())
    session = make_session()
    session.get.return_value = playlist
    spotify = AsyncMock(spec=SpotifyClient)

    response = await request(
        "DELETE", f"{PLAYLISTS_URL}/{PLAYLIST_ID}", session, spotify=spotify, user=make_user()
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Playlist not found"
    spotify.unfollow_playlist.assert_not_awaited()
    session.delete.assert_not_awaited()


async def test_sync_creates_playlist_and_adds_cached_tracks() -> None:
    city = make_city()
    artist_id = uuid.uuid7()
    event_id = uuid.uuid7()
    resolved = SpotifyArtist(
        id=uuid.uuid7(),
        artist_id=artist_id,
        spotify_id="sp1",
        name="Autechre",
        match_confidence="exact",
        top_tracks_synced_at=datetime.now(UTC),
    )
    cached = ArtistTopTrack(artist_id=artist_id, rank=1, title="Gantz Graf", spotify_track_id="t1")
    default = make_playlist(
        city_id=None, name="Alice's concerts in Montréal", spotify_playlist_id=None
    )
    session = make_session()
    session.get.side_effect = [city, city]
    session.execute.side_effect = [
        result_with_scalars([]),
        MagicMock(),
        result_returning(default),
        result_with_rows([(artist_id, event_id, datetime(2026, 8, 1, 20, 0, tzinfo=UTC))]),
        result_with_scalars([resolved]),
        result_with_scalars([cached]),
        result_returning(default.id),  # the claim on the freshly created remote id
        result_with_scalars([]),
        MagicMock(),
    ]
    spotify = AsyncMock(spec=SpotifyClient)
    spotify.create_playlist.return_value = SpotifyPlaylistData(
        id="pl1", url="http://x", snapshot_id="s1"
    )
    spotify.replace_playlist_items.return_value = "s2"

    response = await request(
        "POST",
        SYNC_URL,
        session,
        lastfm=AsyncMock(spec=LastfmClient),
        spotify=spotify,
        musicbrainz=AsyncMock(spec=MusicBrainzClient),
        user=make_user(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["artists_matched"] == 1
    assert body["artists_resolved"] == 1
    assert body["artists_unresolved"] == 0
    assert body["top_tracks_refreshed"] == 0
    assert len(body["playlists"]) == 1
    item = body["playlists"][0]
    assert item["status"] == "synced"
    assert item["created_remotely"] is True
    assert item["tracks_added"] == 1
    assert item["tracks_total"] == 1
    spotify.create_playlist.assert_awaited_once()
    spotify.replace_playlist_items.assert_awaited_once_with("pl1", ["spotify:track:t1"])
    assert default.snapshot_id == "s2"
    tracks = added_objects(session, PlaylistTrack)
    assert [(t.spotify_track_id, t.artist_id, t.event_id) for t in tracks] == [
        ("t1", artist_id, event_id)
    ]
    # One commit banks the resolution/top-track caches, one persists the
    # remote id right after creation, one closes the sync.
    assert session.commit.await_count == 3


async def test_sync_requires_spotify_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    monkeypatch.setattr(
        "app.main.get_settings",
        lambda: Settings(spotify_client_id="", spotify_client_secret="", spotify_refresh_token=""),
    )

    response = await request("POST", SYNC_URL, session, user=make_user())

    assert response.status_code == 503
    # The missing key names go to the logs, never to the user.
    detail = response.json()["detail"]
    assert detail == "This service is temporarily unavailable. Please try again later."
    assert "SPOTIFY" not in detail
