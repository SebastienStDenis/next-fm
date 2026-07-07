import uuid
from datetime import UTC, datetime

from sqlalchemy import Delete

from app.models import (
    Artist,
    Event,
    User,
    UserArtistExclusion,
    UserArtistInterest,
    UserEventExclusion,
)
from tests.helpers import (
    added_objects,
    make_session,
    request,
    result_returning,
    result_with_rows,
    result_with_scalars,
)

USER_ID = uuid.uuid7()
ARTIST_ID = uuid.uuid7()
EVENT_ID = uuid.uuid7()

ARTIST_EXCLUSION_URL = f"/users/{USER_ID}/artists/{ARTIST_ID}/exclusion"
EVENT_EXCLUSION_URL = f"/users/{USER_ID}/events/{EVENT_ID}/exclusion"


def deleted_tables(session) -> list[str]:
    return [
        call.args[0].table.name
        for call in session.execute.call_args_list
        if isinstance(call.args[0], Delete)
    ]


async def test_exclude_artist_creates_exclusion_and_deletes_suggestion() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice"), Artist(id=ARTIST_ID, name="BoC")]
    session.execute.side_effect = [
        result_returning(None),  # delete similar_artist interest
        result_returning(None),  # existing exclusion lookup: none
    ]

    response = await request("PUT", ARTIST_EXCLUSION_URL, session)

    assert response.status_code == 204
    added = added_objects(session, UserArtistExclusion)
    assert len(added) == 1
    assert (added[0].user_id, added[0].artist_id) == (USER_ID, ARTIST_ID)
    assert "user_artist_interests" in deleted_tables(session)
    session.commit.assert_awaited()


async def test_exclude_artist_is_idempotent() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice"), Artist(id=ARTIST_ID, name="BoC")]
    session.execute.side_effect = [
        result_returning(None),  # delete similar_artist interest
        result_returning(uuid.uuid7()),  # existing exclusion lookup: already excluded
    ]

    response = await request("PUT", ARTIST_EXCLUSION_URL, session)

    assert response.status_code == 204
    assert added_objects(session, UserArtistExclusion) == []


async def test_exclude_unknown_artist_is_404() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice"), None]

    response = await request("PUT", ARTIST_EXCLUSION_URL, session)

    assert response.status_code == 404
    assert response.json()["detail"] == "Artist not found"


async def test_unexclude_artist_deletes_exclusion() -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Alice")
    session.execute.return_value = result_returning(None)

    response = await request("DELETE", ARTIST_EXCLUSION_URL, session)

    assert response.status_code == 204
    assert deleted_tables(session) == ["user_artist_exclusions"]
    session.commit.assert_awaited()


async def test_exclude_event_creates_exclusion() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice"), Event(id=EVENT_ID, venue_name="X")]
    session.execute.side_effect = [result_returning(None)]  # existing exclusion lookup: none

    response = await request("PUT", EVENT_EXCLUSION_URL, session)

    assert response.status_code == 204
    added = added_objects(session, UserEventExclusion)
    assert len(added) == 1
    assert (added[0].user_id, added[0].event_id) == (USER_ID, EVENT_ID)


async def test_exclude_event_is_idempotent() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice"), Event(id=EVENT_ID, venue_name="X")]
    session.execute.side_effect = [result_returning(uuid.uuid7())]  # already excluded

    response = await request("PUT", EVENT_EXCLUSION_URL, session)

    assert response.status_code == 204
    assert added_objects(session, UserEventExclusion) == []


async def test_exclude_unknown_event_is_404() -> None:
    session = make_session()
    session.get.side_effect = [User(id=USER_ID, name="Alice"), None]

    response = await request("PUT", EVENT_EXCLUSION_URL, session)

    assert response.status_code == 404
    assert response.json()["detail"] == "Event not found"


async def test_unexclude_event_deletes_exclusion() -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Alice")
    session.execute.return_value = result_returning(None)

    response = await request("DELETE", EVENT_EXCLUSION_URL, session)

    assert response.status_code == 204
    assert deleted_tables(session) == ["user_event_exclusions"]


def interest(artist_id: uuid.UUID, kind: str) -> UserArtistInterest:
    now = datetime.now(UTC)
    return UserArtistInterest(
        user_id=USER_ID,
        artist_id=artist_id,
        kind=kind,
        source="internal",
        evidence={},
        weight=0.9,
        created_at=now,
        updated_at=now,
    )


async def test_list_artists_marks_excluded_and_keeps_excluded_only() -> None:
    plain = Artist(id=uuid.uuid7(), name="Aphex Twin")  # interest, not excluded
    excluded_known = Artist(id=uuid.uuid7(), name="Boards of Canada")  # interest + excluded
    excluded_only = Artist(id=uuid.uuid7(), name="Caribou")  # excluded, no interest left
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Alice")
    session.execute.side_effect = [
        result_with_rows(
            [
                (interest(plain.id, "similar_artist"), plain),
                (interest(excluded_known.id, "lastfm_top_artist"), excluded_known),
            ]
        ),
        result_with_scalars([excluded_known, excluded_only]),
    ]

    response = await request("GET", f"/users/{USER_ID}/artists", session)

    assert response.status_code == 200
    body = response.json()
    assert [entry["artist"]["name"] for entry in body] == [
        "Aphex Twin",
        "Boards of Canada",
        "Caribou",
    ]
    assert [entry["excluded"] for entry in body] == [False, True, True]
    assert body[2]["interests"] == []  # excluded-only artist still visible for undo
