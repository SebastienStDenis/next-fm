import uuid
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient, Response

from app.db import get_session
from app.main import app
from app.models import User

USER_ID = uuid.uuid7()


def make_session() -> AsyncMock:
    session = AsyncMock()
    session.add = MagicMock()

    async def commit() -> None:
        for call in session.add.call_args_list:
            obj = call.args[0]
            if obj.id is None:
                obj.id = uuid.uuid7()

    session.commit = commit
    return session


async def request(
    method: str,
    url: str,
    session: AsyncMock,
    json: dict | None = None,
) -> Response:
    app.dependency_overrides[get_session] = lambda: session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, url, json=json)
    finally:
        app.dependency_overrides.clear()


async def test_create_user() -> None:
    session = make_session()

    response = await request("POST", "/users", session, json={"name": "Alice"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Alice"
    assert uuid.UUID(body["id"])
    session.add.assert_called_once()


async def test_create_user_rejects_empty_name() -> None:
    session = make_session()

    response = await request("POST", "/users", session, json={"name": ""})

    assert response.status_code == 422
    session.add.assert_not_called()


async def test_delete_user() -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Alice")

    response = await request("DELETE", f"/users/{USER_ID}", session)

    assert response.status_code == 204
    session.delete.assert_awaited_once()


async def test_delete_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("DELETE", f"/users/{USER_ID}", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"
    session.delete.assert_not_awaited()
