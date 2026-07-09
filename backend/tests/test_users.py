import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.exc import IntegrityError

from app.auth import Claims
from app.models import User
from tests.helpers import added_objects, request, result_returning

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


async def test_get_me_returns_authenticated_user() -> None:
    session = make_session()
    user = User(id=USER_ID, name="Alice", include_known_artists=False)

    response = await request("GET", "/me", session, user=user)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(USER_ID)
    assert body["name"] == "Alice"


async def test_get_me_requires_authentication() -> None:
    session = make_session()

    response = await request("GET", "/me", session)

    assert response.status_code == 401


async def test_get_me_provisions_user_on_first_login() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)
    sub = uuid.uuid4()

    response = await request(
        "GET",
        "/me",
        session,
        claims=Claims(sub=sub, email="ada@example.com", display_name="Ada"),
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Ada"
    created = added_objects(session, User)
    assert len(created) == 1
    assert created[0].name == "Ada"
    assert created[0].supabase_user_id == sub
    assert created[0].last_seen_at is not None


async def test_get_me_refreshes_stale_last_seen() -> None:
    session = AsyncMock()
    sub = uuid.uuid4()
    stale = datetime.now(UTC) - timedelta(hours=2)
    user = User(
        id=USER_ID,
        name="Ada",
        supabase_user_id=sub,
        include_known_artists=False,
        last_seen_at=stale,
    )
    session.execute.return_value = result_returning(user)

    response = await request("GET", "/me", session, claims=Claims(sub=sub))

    assert response.status_code == 200
    assert user.last_seen_at is not None and user.last_seen_at > stale
    session.commit.assert_awaited_once()


async def test_get_me_leaves_fresh_last_seen_alone() -> None:
    session = AsyncMock()
    sub = uuid.uuid4()
    recent = datetime.now(UTC) - timedelta(minutes=5)
    user = User(
        id=USER_ID,
        name="Ada",
        supabase_user_id=sub,
        include_known_artists=False,
        last_seen_at=recent,
    )
    session.execute.return_value = result_returning(user)

    response = await request("GET", "/me", session, claims=Claims(sub=sub))

    assert response.status_code == 200
    assert user.last_seen_at == recent
    session.commit.assert_not_awaited()


async def test_update_user_sets_include_known_artists() -> None:
    session = make_session()
    user = User(id=USER_ID, name="Alice", include_known_artists=False)

    response = await request(
        "PATCH", "/me", session, user=user, json={"include_known_artists": True}
    )

    assert response.status_code == 200
    assert response.json()["include_known_artists"] is True
    assert user.include_known_artists is True


async def test_update_user_with_empty_payload_changes_nothing() -> None:
    session = make_session()
    user = User(id=USER_ID, name="Alice", include_known_artists=True)

    response = await request("PATCH", "/me", session, user=user, json={})

    assert response.status_code == 200
    assert response.json()["include_known_artists"] is True
    assert user.include_known_artists is True


async def test_delete_me() -> None:
    session = make_session()
    supabase_user_id = uuid.uuid4()
    user = User(id=USER_ID, name="Alice", supabase_user_id=supabase_user_id)
    admin = AsyncMock()

    response = await request("DELETE", "/me", session, user=user, supabase_admin=admin)

    assert response.status_code == 204
    session.delete.assert_awaited_once()
    admin.delete_user.assert_awaited_once_with(supabase_user_id)


async def test_delete_me_requires_authentication() -> None:
    session = make_session()

    response = await request("DELETE", "/me", session)

    assert response.status_code == 401
    session.delete.assert_not_awaited()


async def test_delete_me_unlinked_user_needs_no_admin() -> None:
    session = make_session()
    user = User(id=USER_ID, name="Alice", supabase_user_id=None)

    response = await request("DELETE", "/me", session, user=user)

    assert response.status_code == 204
    session.delete.assert_awaited_once()


async def test_get_me_adopts_user_provisioned_by_a_concurrent_request() -> None:
    session = make_session()
    sub = uuid.uuid4()
    existing = User(id=USER_ID, name="Ada", supabase_user_id=sub, include_known_artists=False)
    session.execute.side_effect = [result_returning(None), result_returning(existing)]

    # Only the provisioning INSERT collides; the later last_seen_at stamp commits fine.
    session.commit = AsyncMock(
        side_effect=[IntegrityError("INSERT", {}, Exception("duplicate supabase_user_id")), None]
    )

    response = await request(
        "GET",
        "/me",
        session,
        claims=Claims(sub=sub, email="ada@example.com", display_name="Ada"),
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(USER_ID)
    session.rollback.assert_awaited_once()
