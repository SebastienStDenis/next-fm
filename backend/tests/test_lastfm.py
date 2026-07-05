import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient, Response

from app.db import get_session
from app.lastfm import (
    LastfmClient,
    LastfmUserInfo,
    LastfmUserNotFoundError,
    _parse_user_info,
)
from app.main import app, get_lastfm_client
from app.models import LastfmAccount

USER_ID = uuid.uuid7()

USER_INFO = LastfmUserInfo(
    username="rj",
    real_name="Richard",
    avatar_url="https://images.example/rj.png",
    profile_url="https://www.last.fm/user/rj",
    country="United Kingdom",
    registered_at=datetime(2002, 11, 20, tzinfo=UTC),
    playcount=123456,
    artist_count=789,
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
        playcount=100,
        artist_count=10,
        last_synced_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def make_session() -> AsyncMock:
    session = AsyncMock()
    session.add = MagicMock()

    async def flush() -> None:
        for call in session.add.call_args_list:
            obj = call.args[0]
            if obj.id is None:
                obj.id = uuid.uuid7()

    session.flush = flush
    return session


def result_returning(value: object) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


async def request(
    method: str,
    url: str,
    session: AsyncMock,
    lastfm: LastfmClient | None = None,
    json: dict | None = None,
) -> Response:
    app.dependency_overrides[get_session] = lambda: session
    if lastfm is not None:
        app.dependency_overrides[get_lastfm_client] = lambda: lastfm
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, url, json=json)
    finally:
        app.dependency_overrides.clear()


async def test_get_linked_account() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())

    response = await request("GET", f"/users/{USER_ID}/lastfm", session)

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "rj"
    assert body["playcount"] == 100


async def test_get_linked_account_when_none() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("GET", f"/users/{USER_ID}/lastfm", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"


async def test_get_linked_account_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("GET", f"/users/{USER_ID}/lastfm", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


async def test_link_creates_account_and_connection() -> None:
    session = make_session()
    session.execute.side_effect = [result_returning(None), result_returning(None)]
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO

    response = await request(
        "PUT", f"/users/{USER_ID}/lastfm", session, lastfm, json={"username": "RJ"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "rj"
    assert body["playcount"] == 123456
    lastfm.get_user_info.assert_awaited_once_with("RJ")
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
        "PUT", f"/users/{USER_ID}/lastfm", session, lastfm, json={"username": "rj"}
    )

    assert response.status_code == 200
    assert response.json()["playcount"] == 123456
    session.add.assert_not_called()
    assert connection.lastfm_account_id == account.id
    session.commit.assert_awaited_once()


async def test_link_unknown_lastfm_user() -> None:
    session = make_session()
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.side_effect = LastfmUserNotFoundError("nope")

    response = await request(
        "PUT", f"/users/{USER_ID}/lastfm", session, lastfm, json={"username": "nope"}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Last.fm user not found"
    session.commit.assert_not_awaited()


async def test_refresh_updates_account() -> None:
    account = make_account()
    session = make_session()
    session.execute.return_value = result_returning(account)
    lastfm = AsyncMock(spec=LastfmClient)
    lastfm.get_user_info.return_value = USER_INFO

    response = await request("POST", f"/users/{USER_ID}/lastfm/refresh", session, lastfm)

    assert response.status_code == 200
    assert response.json()["playcount"] == 123456
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
            "playcount": "123456",
            "artist_count": "789",
        }
    )

    assert info.username == "rj"
    assert info.avatar_url == "https://images.example/xl.png"
    assert info.registered_at == datetime.fromtimestamp(1037836800, tz=UTC)
    assert info.playcount == 123456
    assert info.artist_count == 789


def test_parse_user_info_treats_placeholders_as_none() -> None:
    info = _parse_user_info(
        {
            "name": "someone",
            "realname": "",
            "country": "None",
            "image": [{"size": "small", "#text": ""}],
            "registered": {"unixtime": ""},
            "playcount": "0",
        }
    )

    assert info.real_name is None
    assert info.country is None
    assert info.avatar_url is None
    assert info.registered_at is None
    assert info.playcount == 0
    assert info.artist_count is None


async def test_refresh_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)
    lastfm = AsyncMock(spec=LastfmClient)

    response = await request("POST", f"/users/{USER_ID}/lastfm/refresh", session, lastfm)

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"


async def test_unlink_deletes_connection() -> None:
    connection = MagicMock()
    session = make_session()
    session.execute.return_value = result_returning(connection)

    response = await request("DELETE", f"/users/{USER_ID}/lastfm", session)

    assert response.status_code == 204
    session.delete.assert_awaited_once_with(connection)
    session.commit.assert_awaited_once()


async def test_unlink_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("DELETE", f"/users/{USER_ID}/lastfm", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"
    session.delete.assert_not_awaited()
