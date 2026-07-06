import uuid
from unittest.mock import AsyncMock, MagicMock

from app.models import User
from tests.helpers import request

USER_ID = uuid.uuid7()


def make_session() -> AsyncMock:
    session = AsyncMock()
    session.add = MagicMock()

    async def commit() -> None:
        # Mimic what a real flush does: apply ids and column defaults.
        for call in session.add.call_args_list:
            obj = call.args[0]
            if obj.id is None:
                obj.id = uuid.uuid7()
            if isinstance(obj, User) and obj.include_known_artists is None:
                obj.include_known_artists = False

    session.commit = commit
    return session


async def test_create_user() -> None:
    session = make_session()

    response = await request("POST", "/users", session, json={"name": "Alice"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Alice"
    assert body["include_known_artists"] is False
    assert uuid.UUID(body["id"])
    session.add.assert_called_once()


async def test_create_user_rejects_empty_name() -> None:
    session = make_session()

    response = await request("POST", "/users", session, json={"name": ""})

    assert response.status_code == 422
    session.add.assert_not_called()


async def test_update_user_sets_include_known_artists() -> None:
    session = make_session()
    user = User(id=USER_ID, name="Alice", include_known_artists=False)
    session.get.return_value = user

    response = await request(
        "PATCH", f"/users/{USER_ID}", session, json={"include_known_artists": True}
    )

    assert response.status_code == 200
    assert response.json()["include_known_artists"] is True
    assert user.include_known_artists is True


async def test_update_user_with_empty_payload_changes_nothing() -> None:
    session = make_session()
    user = User(id=USER_ID, name="Alice", include_known_artists=True)
    session.get.return_value = user

    response = await request("PATCH", f"/users/{USER_ID}", session, json={})

    assert response.status_code == 200
    assert response.json()["include_known_artists"] is True
    assert user.include_known_artists is True


async def test_update_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request(
        "PATCH", f"/users/{USER_ID}", session, json={"include_known_artists": True}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


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
