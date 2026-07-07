import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.dialects import postgresql

from app.models import Artist, City, Event, UserArtistInterest
from tests.helpers import make_session, request, result_with_rows, result_with_scalars

USER_ID = uuid.uuid7()
ARTIST_ID = uuid.uuid7()
EVENT_ID = uuid.uuid7()

MONTREAL = City(
    geonameid=6077243,
    name="Montréal",
    ascii_name="Montreal",
    admin1="Quebec",
    country_code="CA",
    latitude=45.50884,
    longitude=-73.58781,
    population=1600000,
)


def executed_statements(session: AsyncMock) -> list:
    return [call.args[0] for call in session.execute.await_args_list]


def compiled(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


async def test_exclude_artist_writes_policy_and_drops_suggestion() -> None:
    session = make_session()
    session.get.side_effect = [MagicMock(), MagicMock(spec=Artist)]

    response = await request("PUT", f"/users/{USER_ID}/artists/{ARTIST_ID}/exclusion", session)

    assert response.status_code == 204
    insert_stmt, delete_stmt = executed_statements(session)
    assert "INSERT INTO user_artist_exclusions" in compiled(insert_stmt)
    assert "ON CONFLICT DO NOTHING" in compiled(insert_stmt)  # idempotent
    assert "DELETE FROM user_artist_interests" in compiled(delete_stmt)
    assert "similar_artist" in delete_stmt.compile(dialect=postgresql.dialect()).params.values()
    session.commit.assert_awaited_once()


async def test_exclude_unknown_artist() -> None:
    session = make_session()
    session.get.side_effect = [MagicMock(), None]

    response = await request("PUT", f"/users/{USER_ID}/artists/{ARTIST_ID}/exclusion", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "Artist not found"
    session.execute.assert_not_awaited()


async def test_exclude_artist_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("PUT", f"/users/{USER_ID}/artists/{ARTIST_ID}/exclusion", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


async def test_unexclude_artist() -> None:
    session = make_session()
    session.get.return_value = MagicMock()

    response = await request("DELETE", f"/users/{USER_ID}/artists/{ARTIST_ID}/exclusion", session)

    assert response.status_code == 204
    (delete_stmt,) = executed_statements(session)
    assert "DELETE FROM user_artist_exclusions" in compiled(delete_stmt)
    session.commit.assert_awaited_once()


async def test_ignore_event_writes_policy() -> None:
    session = make_session()
    session.get.side_effect = [MagicMock(), MagicMock(spec=Event)]

    response = await request("PUT", f"/users/{USER_ID}/events/{EVENT_ID}/exclusion", session)

    assert response.status_code == 204
    (insert_stmt,) = executed_statements(session)
    assert "INSERT INTO user_event_exclusions" in compiled(insert_stmt)
    assert "ON CONFLICT DO NOTHING" in compiled(insert_stmt)  # idempotent
    session.commit.assert_awaited_once()


async def test_ignore_unknown_event() -> None:
    session = make_session()
    session.get.side_effect = [MagicMock(), None]

    response = await request("PUT", f"/users/{USER_ID}/events/{EVENT_ID}/exclusion", session)

    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"
    session.execute.assert_not_awaited()


async def test_unignore_event() -> None:
    session = make_session()
    session.get.return_value = MagicMock()

    response = await request("DELETE", f"/users/{USER_ID}/events/{EVENT_ID}/exclusion", session)

    assert response.status_code == 204
    (delete_stmt,) = executed_statements(session)
    assert "DELETE FROM user_event_exclusions" in compiled(delete_stmt)
    session.commit.assert_awaited_once()


NOW = datetime(2026, 7, 1, tzinfo=UTC)


def interest_row(artist: Artist) -> UserArtistInterest:
    return UserArtistInterest(
        user_id=USER_ID,
        artist_id=artist.id,
        kind="lastfm_top_artist",
        source="lastfm",
        evidence={},
        created_at=NOW,
        updated_at=NOW,
    )


async def test_list_user_artists_flags_excluded() -> None:
    listened = Artist(id=uuid.uuid7(), name="Autechre")
    ignored = Artist(id=uuid.uuid7(), name="Boards of Canada")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([ignored.id]),  # exclusions
        result_with_rows([(interest_row(listened), listened), (interest_row(ignored), ignored)]),
    ]

    response = await request("GET", f"/users/{USER_ID}/artists", session)

    assert response.status_code == 200
    body = response.json()
    assert [(entry["artist"]["name"], entry["excluded"]) for entry in body] == [
        ("Autechre", False),
        ("Boards of Canada", True),
    ]


async def test_list_user_artists_keeps_excluded_artists_without_interests() -> None:
    # Excluding a suggested-only artist deletes its suggestion row; the
    # listing must still show it so the ignore is visible and reversible.
    listened = Artist(id=uuid.uuid7(), name="Autechre")
    ignored = Artist(id=uuid.uuid7(), name="Boards of Canada")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([ignored.id]),  # exclusions
        result_with_rows([(interest_row(listened), listened)]),
        result_with_scalars([ignored]),  # excluded artists with no interests
    ]

    response = await request("GET", f"/users/{USER_ID}/artists", session)

    assert response.status_code == 200
    body = response.json()
    assert [(entry["artist"]["name"], entry["excluded"]) for entry in body] == [
        ("Autechre", False),
        ("Boards of Canada", True),
    ]
    assert body[1]["interests"] == []


def make_matched_event() -> Event:
    return Event(
        id=EVENT_ID,
        title=None,
        venue_name="MTELUS",
        venue_latitude=45.51,
        venue_longitude=-73.56,
        city_name="Montreal",
        region="QC",
        country="Canada",
        starts_at=datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
    )


async def test_list_events_hides_ignored_by_default() -> None:
    session = make_session()
    session.get.side_effect = [MagicMock(city_id=MONTREAL.geonameid), MONTREAL]
    session.execute.return_value = result_with_rows([])

    response = await request("GET", f"/users/{USER_ID}/events", session)

    assert response.status_code == 200
    assert response.json() == []
    (query,) = executed_statements(session)
    # Once as the selected ignored flag, once as the NOT EXISTS filter.
    assert compiled(query).count("FROM user_event_exclusions") == 2


async def test_list_events_include_ignored_flags_rows() -> None:
    event = make_matched_event()
    artist = Artist(id=uuid.uuid7(), name="Autechre")
    session = make_session()
    session.get.side_effect = [MagicMock(city_id=MONTREAL.geonameid), MONTREAL]
    session.execute.return_value = result_with_rows([(event, artist, None, 2.9412, True)])

    response = await request("GET", f"/users/{USER_ID}/events?include_ignored=true", session)

    assert response.status_code == 200
    body = response.json()
    assert body[0]["ignored"] is True
    (query,) = executed_statements(session)
    # Only the selected ignored flag remains; the filter is lifted.
    assert compiled(query).count("FROM user_event_exclusions") == 1
