import uuid

from sqlalchemy.dialects import postgresql

from app.models import Artist, User
from tests.helpers import make_session, request

USER_ID = uuid.uuid7()


def user() -> User:
    return User(id=USER_ID, name="Alice", include_known_artists=False)


def exclusion_url(artist_id: uuid.UUID) -> str:
    return f"/me/artists/{artist_id}/exclusion"


async def test_exclude_artist_inserts_exclusion_and_drops_suggestion() -> None:
    artist = Artist(id=uuid.uuid7(), name="Autechre")
    session = make_session()
    session.get.return_value = artist

    response = await request("PUT", exclusion_url(artist.id), session, user=user())

    assert response.status_code == 204
    insert_stmt, delete_stmt = [call.args[0] for call in session.execute.await_args_list]
    assert insert_stmt.table.name == "user_artist_exclusions"
    params = insert_stmt.compile(dialect=postgresql.dialect()).params
    assert params["user_id"] == USER_ID
    assert params["artist_id"] == artist.id
    assert delete_stmt.table.name == "user_artist_interests"
    # The delete must stay scoped to the pair's suggestion row: dropping any
    # predicate would wipe imported listening history on every ignore.
    delete_params = delete_stmt.compile(dialect=postgresql.dialect()).params
    assert set(delete_params.values()) == {USER_ID, artist.id, "similar_artist"}
    session.commit.assert_awaited_once()


async def test_exclude_artist_unknown_artist_404() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("PUT", exclusion_url(uuid.uuid7()), session, user=user())

    assert response.status_code == 404
    assert response.json()["detail"] == "Artist not found"
    session.commit.assert_not_awaited()


async def test_exclude_artist_requires_authentication() -> None:
    response = await request("PUT", exclusion_url(uuid.uuid7()), make_session())

    assert response.status_code == 401


async def test_unexclude_artist_deletes_exclusion() -> None:
    artist_id = uuid.uuid7()
    session = make_session()

    response = await request("DELETE", exclusion_url(artist_id), session, user=user())

    assert response.status_code == 204
    (delete_stmt,) = [call.args[0] for call in session.execute.await_args_list]
    assert delete_stmt.table.name == "user_artist_exclusions"
    delete_params = delete_stmt.compile(dialect=postgresql.dialect()).params
    assert set(delete_params.values()) == {USER_ID, artist_id}
    session.commit.assert_awaited_once()


async def test_unexclude_artist_requires_authentication() -> None:
    response = await request("DELETE", exclusion_url(uuid.uuid7()), make_session())

    assert response.status_code == 401
