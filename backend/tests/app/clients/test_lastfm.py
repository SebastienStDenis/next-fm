import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.clients.lastfm import (
    LastfmApiError,
    LastfmArtistNotFoundError,
    LastfmArtistTopTrack,
    LastfmClient,
    LastfmLovedTrack,
    LastfmPrivateDataError,
    LastfmSimilarArtistData,
    LastfmUserInfo,
    LastfmUserNotFoundError,
    _as_list,
    _parse_artist_info,
    _parse_artist_top_track,
    _parse_loved_track,
    _parse_top_artist,
    _parse_user_info,
    visible_tags,
)
from app.core.models import LastfmAccount, User
from tests.helpers import make_session, request, result_returning

USER_ID = uuid.uuid7()


def user() -> User:
    return User(id=USER_ID, name="Alice", include_known_artists=False)


USER_INFO = LastfmUserInfo(
    username="rj",
    real_name="Richard",
    avatar_url="https://images.example/rj.png",
    profile_url="https://www.last.fm/user/rj",
    country="United Kingdom",
    registered_at=datetime(2002, 11, 20, tzinfo=UTC),
)


def make_account() -> LastfmAccount:
    return LastfmAccount(
        id=uuid.uuid7(),
        username="rj",
        real_name="Richard",
        avatar_url="https://images.example/rj.png",
        profile_url="https://www.last.fm/user/rj",
        country="United Kingdom",
        registered_at=datetime(2002, 11, 20, tzinfo=UTC),
        last_synced_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


async def test_get_linked_account() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())

    response = await request("GET", "/me/lastfm", session, user=user())

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "rj"


async def test_get_linked_account_when_none() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("GET", "/me/lastfm", session, user=user())

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"


async def test_get_linked_account_requires_authentication() -> None:
    session = make_session()

    response = await request("GET", "/me/lastfm", session)

    assert response.status_code == 401


async def test_link_creates_account_and_connection() -> None:
    session = make_session()
    session.execute.side_effect = [result_returning(None), result_returning(None)]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO

    response = await request(
        "PUT", "/me/lastfm", session, lastfm, user=user(), json={"username": "RJ"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "rj"
    lastfm.get_user_info.assert_awaited_once_with("RJ")
    lastfm.get_top_artists.assert_awaited_once_with("rj", limit=1)
    lastfm.get_loved_tracks.assert_awaited_once_with("rj", limit=1)
    assert session.add.call_count == 2
    session.commit.assert_awaited_once()


async def test_link_replaces_existing_connection() -> None:
    account = make_account()
    connection = MagicMock()
    session = make_session()
    session.execute.side_effect = [result_returning(account), result_returning(connection)]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO

    response = await request(
        "PUT", "/me/lastfm", session, lastfm, user=user(), json={"username": "rj"}
    )

    assert response.status_code == 200
    assert response.json()["username"] == "rj"
    session.add.assert_not_called()
    assert connection.lastfm_account_id == account.id
    session.commit.assert_awaited_once()


async def test_link_unknown_lastfm_user() -> None:
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.side_effect = LastfmUserNotFoundError("nope")

    response = await request(
        "PUT", "/me/lastfm", session, lastfm, user=user(), json={"username": "nope"}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Last.fm user not found"
    session.commit.assert_not_awaited()


async def test_link_private_lastfm_account() -> None:
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO
    lastfm.get_top_artists.side_effect = LastfmPrivateDataError("rj")

    response = await request(
        "PUT", "/me/lastfm", session, lastfm, user=user(), json={"username": "rj"}
    )

    assert response.status_code == 403
    assert "visibility settings" in response.json()["detail"]
    session.add.assert_not_called()
    session.commit.assert_not_awaited()


async def test_link_probes_loved_tracks_too() -> None:
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO
    lastfm.get_loved_tracks.side_effect = LastfmPrivateDataError("rj")

    response = await request(
        "PUT", "/me/lastfm", session, lastfm, user=user(), json={"username": "rj"}
    )

    assert response.status_code == 403
    session.add.assert_not_called()
    session.commit.assert_not_awaited()


async def test_refresh_updates_account() -> None:
    account = make_account()
    session = make_session()
    session.execute.return_value = result_returning(account)
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO

    response = await request("POST", "/me/lastfm/refresh", session, lastfm, user=user())

    assert response.status_code == 200
    assert response.json()["username"] == "rj"
    lastfm.get_user_info.assert_awaited_once_with("rj")
    session.commit.assert_awaited_once()


def test_parse_user_info() -> None:
    info = _parse_user_info(
        {
            "name": "rj",
            "realname": "Richard",
            "url": "https://www.last.fm/user/rj",
            "country": "United Kingdom",
            "image": [
                {"size": "small", "#text": "https://images.example/small.png"},
                {"size": "extralarge", "#text": "https://images.example/xl.png"},
            ],
            "registered": {"unixtime": "1037836800"},
        }
    )

    assert info.username == "rj"
    assert info.avatar_url == "https://images.example/xl.png"
    assert info.registered_at == datetime.fromtimestamp(1037836800, tz=UTC)


def test_parse_user_info_treats_placeholders_as_none() -> None:
    info = _parse_user_info(
        {
            "name": "someone",
            "realname": "",
            "country": "None",
            "image": [{"size": "small", "#text": ""}],
            "registered": {"unixtime": ""},
        }
    )

    assert info.real_name is None
    assert info.country is None
    assert info.avatar_url is None
    assert info.registered_at is None


def test_parse_top_artist() -> None:
    artist = _parse_top_artist(
        {
            "name": "Autechre",
            "url": "https://www.last.fm/music/Autechre",
            "mbid": "410c9baf-5469-44f6-9852-826524b80c61",
            "playcount": "321",
            "@attr": {"rank": "3"},
        }
    )

    assert artist.name == "Autechre"
    assert artist.url == "https://www.last.fm/music/Autechre"
    assert artist.mbid == "410c9baf-5469-44f6-9852-826524b80c61"
    assert artist.playcount == 321
    assert artist.rank == 3


def test_parse_top_artist_treats_placeholders_as_none() -> None:
    artist = _parse_top_artist({"name": "Autechre", "url": "", "mbid": "", "playcount": ""})

    assert artist.name == "Autechre"
    assert artist.url is None
    assert artist.mbid is None
    assert artist.playcount is None
    assert artist.rank is None


def test_parse_loved_track() -> None:
    track = _parse_loved_track(
        {
            "name": "Windowlicker",
            "artist": {
                "name": "Aphex Twin",
                "url": "https://www.last.fm/music/Aphex+Twin",
                "mbid": "f22942a1-6f70-4f48-866e-238cb2308fbd",
            },
        }
    )

    assert track.title == "Windowlicker"
    assert track.artist_name == "Aphex Twin"
    assert track.artist_url == "https://www.last.fm/music/Aphex+Twin"
    assert track.artist_mbid == "f22942a1-6f70-4f48-866e-238cb2308fbd"


def test_parse_loved_track_treats_placeholders_as_none() -> None:
    track = _parse_loved_track({"name": "Roygbiv", "artist": {"name": "Boards of Canada"}})

    assert track.artist_url is None
    assert track.artist_mbid is None


def test_parse_artist_top_track() -> None:
    track = _parse_artist_top_track(
        {"name": "Windowlicker", "playcount": "999", "@attr": {"rank": "2"}}
    )

    assert track.title == "Windowlicker"
    assert track.rank == 2
    assert track.playcount == 999


def test_parse_artist_top_track_treats_placeholders_as_none() -> None:
    track = _parse_artist_top_track({"name": "Untitled", "playcount": ""})

    assert track.title == "Untitled"
    assert track.rank is None
    assert track.playcount is None


def test_parse_artist_info() -> None:
    info = _parse_artist_info(
        {
            "name": "Autechre",
            "url": "https://www.last.fm/music/Autechre",
            "mbid": "410c9baf-5469-44f6-9852-826524b80c61",
            "stats": {"listeners": "700000", "playcount": "9000000"},
            "tags": {
                "tag": [
                    {"name": "electronic", "url": "https://www.last.fm/tag/electronic"},
                    {"name": "idm", "url": "https://www.last.fm/tag/idm"},
                ]
            },
        }
    )

    assert info.name == "Autechre"
    assert info.url == "https://www.last.fm/music/Autechre"
    assert info.mbid == "410c9baf-5469-44f6-9852-826524b80c61"
    assert info.listeners == 700_000
    assert info.playcount == 9_000_000
    assert info.tags == ["electronic", "idm"]


def test_parse_artist_info_treats_placeholders_as_none() -> None:
    info = _parse_artist_info({"name": "Obscure", "url": "", "mbid": "", "tags": ""})

    assert info.url is None
    assert info.mbid is None
    assert info.listeners is None
    assert info.playcount is None
    assert info.tags == []


def test_visible_tags_drops_meta_tags_case_insensitively() -> None:
    tags = ["electronic", "Seen Live", "idm", "female vocalists", "FAVORITES"]

    assert visible_tags(tags) == ["electronic", "idm"]


def test_as_list_wraps_single_object() -> None:
    assert _as_list({"artist": {"name": "Solo"}}, "artist") == [{"name": "Solo"}]


def test_as_list_passes_lists_through_and_defaults_to_empty() -> None:
    assert _as_list({"artist": [{"name": "A"}, {"name": "B"}]}, "artist") == [
        {"name": "A"},
        {"name": "B"},
    ]
    assert _as_list({}, "artist") == []


def stub_lastfm_api(monkeypatch: pytest.MonkeyPatch, payload: dict) -> None:
    async def get(self: httpx.AsyncClient, url: str, params: dict | None = None) -> httpx.Response:
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", get)


async def test_get_top_artists_raises_on_private_data(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(monkeypatch, {"error": 17, "message": "Login: User required to be logged in"})

    with pytest.raises(LastfmPrivateDataError):
        await LastfmClient("key").get_top_artists("rj")


async def test_get_top_artists_raises_on_unmapped_error(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(monkeypatch, {"error": 29, "message": "Rate limit exceeded"})

    with pytest.raises(LastfmApiError):
        await LastfmClient("key").get_top_artists("rj")


async def test_get_loved_tracks_parses_single_track_page(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(
        monkeypatch,
        {
            "lovedtracks": {
                "track": {
                    "name": "Windowlicker",
                    "artist": {"name": "Aphex Twin", "url": "", "mbid": ""},
                },
                "@attr": {"totalPages": "3"},
            }
        },
    )

    page = await LastfmClient("key").get_loved_tracks("rj")

    assert page.total_pages == 3
    assert page.tracks == [
        LastfmLovedTrack(
            title="Windowlicker", artist_name="Aphex Twin", artist_url=None, artist_mbid=None
        )
    ]


async def test_get_loved_tracks_defaults_to_one_page(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(monkeypatch, {"lovedtracks": {"track": []}})

    page = await LastfmClient("key").get_loved_tracks("rj")

    assert page.total_pages == 1
    assert page.tracks == []


async def test_get_artist_top_tracks_parses_ranked_tracks(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(
        monkeypatch,
        {
            "toptracks": {
                "track": [
                    {"name": "Windowlicker", "playcount": "999", "@attr": {"rank": "1"}},
                    {"name": "Avril 14th", "playcount": "888", "@attr": {"rank": "2"}},
                ]
            }
        },
    )

    tracks = await LastfmClient("key").get_artist_top_tracks("Aphex Twin")

    assert tracks == [
        LastfmArtistTopTrack(title="Windowlicker", rank=1, playcount=999),
        LastfmArtistTopTrack(title="Avril 14th", rank=2, playcount=888),
    ]


async def test_get_artist_top_tracks_raises_on_unknown_artist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_lastfm_api(monkeypatch, {"error": 6, "message": "The artist could not be found"})

    with pytest.raises(LastfmArtistNotFoundError):
        await LastfmClient("key").get_artist_top_tracks("nope")


async def test_get_similar_artists_parses_match_scores(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(
        monkeypatch,
        {
            "similarartists": {
                "artist": [
                    {"name": "Boards of Canada", "mbid": "mbid-boc", "match": "1"},
                    {"name": "Plaid", "mbid": "", "match": "0.72"},
                ]
            }
        },
    )

    similar = await LastfmClient("key").get_similar_artists("Autechre")

    assert similar == [
        LastfmSimilarArtistData(name="Boards of Canada", mbid="mbid-boc", match=1.0),
        LastfmSimilarArtistData(name="Plaid", mbid=None, match=0.72),
    ]


async def test_get_similar_artists_raises_on_unknown_artist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_lastfm_api(monkeypatch, {"error": 6, "message": "The artist could not be found"})

    with pytest.raises(LastfmArtistNotFoundError):
        await LastfmClient("key").get_similar_artists("nope")


async def test_get_artist_info_parses_single_tag(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_lastfm_api(
        monkeypatch,
        {
            "artist": {
                "name": "Autechre",
                "url": "https://www.last.fm/music/Autechre",
                "stats": {"listeners": "700000", "playcount": "9000000"},
                "tags": {"tag": {"name": "electronic"}},
            }
        },
    )

    info = await LastfmClient("key").get_artist_info("Autechre")

    assert info.tags == ["electronic"]
    assert info.listeners == 700_000


async def test_get_artist_info_raises_on_unknown_artist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_lastfm_api(monkeypatch, {"error": 6, "message": "The artist could not be found"})

    with pytest.raises(LastfmArtistNotFoundError):
        await LastfmClient("key").get_artist_info("nope")


async def test_refresh_private_lastfm_account() -> None:
    account = make_account()
    session = make_session()
    session.execute.return_value = result_returning(account)
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO
    lastfm.get_top_artists.side_effect = LastfmPrivateDataError("rj")

    response = await request("POST", "/me/lastfm/refresh", session, lastfm, user=user())

    assert response.status_code == 403
    assert "visibility settings" in response.json()["detail"]
    session.commit.assert_not_awaited()


async def test_refresh_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)
    lastfm = AsyncMock(spec=LastfmClient)

    response = await request("POST", "/me/lastfm/refresh", session, lastfm, user=user())

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"


async def test_unlink_deletes_connection() -> None:
    connection = MagicMock()
    session = make_session()
    session.execute.return_value = result_returning(connection)

    response = await request("DELETE", "/me/lastfm", session, user=user())

    assert response.status_code == 204
    session.delete.assert_awaited_once_with(connection)
    session.commit.assert_awaited_once()


async def test_unlink_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("DELETE", "/me/lastfm", session, user=user())

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"
    session.delete.assert_not_awaited()
