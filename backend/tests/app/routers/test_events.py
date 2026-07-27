import uuid
from datetime import UTC, datetime, timedelta

from app.core.models import Artist, City, Event, User
from app.sync.artist_sync import LOVED_TRACKS_KIND
from app.sync.matching import SIMILAR_ARTIST_KIND
from tests.helpers import make_session, request, result_with_rows

USER_ID = uuid.uuid7()
CITY = City(geonameid=6077243, name="Montréal", latitude=45.5, longitude=-73.6)


def user() -> User:
    return User(id=USER_ID, name="Alice", include_known_artists=False, city_id=CITY.geonameid)


def make_event(title: str | None = None) -> Event:
    return Event(
        id=uuid.uuid7(),
        title=title,
        venue_name="Agganis Arena",
        venue_latitude=45.5,
        venue_longitude=-73.6,
        city_name="Montréal",
        region="Quebec",
        country="Canada",
        starts_at=datetime.now(UTC) + timedelta(days=7),
    )


async def test_list_events_collapses_an_act_to_one_artist() -> None:
    event = make_event()
    known = Artist(id=uuid.uuid7(), name="Robyn")
    alias = Artist(id=uuid.uuid7(), name="Robyn & La Bagatelle Magique")
    session = make_session()
    session.get.return_value = CITY
    session.execute.side_effect = [
        result_with_rows(
            [
                (event, known, "https://bandsintown.com/e/1", 3.2),
                (event, alias, "https://bandsintown.com/e/1", 3.2),
            ]
        ),
        result_with_rows(
            [
                ("7928", known.id, known.name, LOVED_TRACKS_KIND, 6.0),
                ("7928", alias.id, alias.name, SIMILAR_ARTIST_KIND, 0.9),
            ]
        ),
    ]

    response = await request("GET", "/me/events", session, user=user())

    assert response.status_code == 200
    (entry,) = response.json()
    assert entry["event"]["id"] == str(event.id)
    assert [artist["name"] for artist in entry["artists"]] == ["Robyn"]


async def test_list_events_keeps_genuine_co_bills() -> None:
    event = make_event(title="Porta Ferrada Festival")
    harper = Artist(id=uuid.uuid7(), name="Ben Harper")
    chic = Artist(id=uuid.uuid7(), name="Nile Rodgers & Chic")
    session = make_session()
    session.get.return_value = CITY
    session.execute.side_effect = [
        result_with_rows(
            [
                (event, harper, None, 3.2),
                (event, chic, None, 3.2),
            ]
        ),
        result_with_rows(
            [
                ("436", harper.id, harper.name, LOVED_TRACKS_KIND, 6.0),
                ("128", chic.id, chic.name, SIMILAR_ARTIST_KIND, 0.9),
            ]
        ),
    ]

    response = await request("GET", "/me/events", session, user=user())

    assert response.status_code == 200
    (entry,) = response.json()
    assert [artist["name"] for artist in entry["artists"]] == [
        "Ben Harper",
        "Nile Rodgers & Chic",
    ]
