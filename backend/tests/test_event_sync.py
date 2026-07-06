import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from app.bandsintown import (
    BandsintownArtistNotFoundError,
    BandsintownClient,
    BandsintownEventData,
)
from app.models import Artist, BandsintownArtist, BandsintownEvent, City, Event
from tests.helpers import make_session, request

USER_ID = uuid.uuid7()
SYNC_URL = f"/users/{USER_ID}/events/sync"
EVENTS_URL = f"/users/{USER_ID}/events"


def event_data(external_id: str, starts_at: datetime | None = None) -> BandsintownEventData:
    return BandsintownEventData(
        external_id=external_id,
        artist_external_id="128",
        title=None,
        url=f"https://www.bandsintown.com/e/{external_id}",
        starts_at=starts_at or datetime(2026, 10, 1, 20, 30, tzinfo=UTC),
        lineup=["Metallica"],
        venue_name="Sphere",
        venue_latitude=36.121217,
        venue_longitude=-115.1620404,
        city_name="Las Vegas",
        region="NV",
        country="United States",
    )


def make_event(external_id: str) -> tuple[BandsintownEvent, Event]:
    event = Event(
        id=uuid.uuid7(),
        title=None,
        venue_name="Old Venue",
        venue_latitude=0.0,
        venue_longitude=0.0,
        city_name="Nowhere",
        region=None,
        country=None,
        starts_at=datetime(2026, 9, 1, tzinfo=UTC),
    )
    source = BandsintownEvent(id=uuid.uuid7(), event_id=event.id, external_id=external_id)
    return source, event


def result_with_scalars(rows: list) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value = rows
    return result


def result_with_rows(rows: list) -> MagicMock:
    result = MagicMock()
    result.all.return_value = rows
    return result


def added_objects(session: AsyncMock, kind: type) -> list:
    return [call.args[0] for call in session.add.call_args_list if isinstance(call.args[0], kind)]


async def test_sync_creates_events_for_new_artist() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
        result_with_rows([]),
        MagicMock(),
        result_with_scalars([]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.return_value = [event_data("101"), event_data("102")]

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown)

    assert response.status_code == 200
    body = response.json()
    assert body["artists_total"] == 1
    assert body["artists_synced"] == 1
    assert body["artists_skipped"] == 0
    assert body["artists_unknown"] == 0
    assert body["events_created"] == 2
    assert body["events_updated"] == 0
    assert body["events_removed"] == 0
    bandsintown.get_artist_events.assert_awaited_once_with("Metallica")

    events = added_objects(session, Event)
    assert len(events) == 2
    assert events[0].venue_name == "Sphere"
    sources = added_objects(session, BandsintownEvent)
    assert [source.external_id for source in sources] == ["101", "102"]
    identities = added_objects(session, BandsintownArtist)
    assert len(identities) == 1
    assert identities[0].name == "Metallica"
    assert identities[0].external_id == "128"
    assert identities[0].last_synced_at is not None
    session.commit.assert_awaited_once()


async def test_sync_skips_recently_synced_artists() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    identity = BandsintownArtist(
        artist_id=artist.id, name="Metallica", last_synced_at=datetime.now(UTC)
    )
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([identity]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown)

    assert response.status_code == 200
    body = response.json()
    assert body["artists_skipped"] == 1
    assert body["artists_synced"] == 0
    bandsintown.get_artist_events.assert_not_awaited()


async def test_sync_updates_existing_and_removes_vanished_events() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    identity = BandsintownArtist(
        artist_id=artist.id,
        name="Metallica",
        external_id="128",
        last_synced_at=datetime.now(UTC) - timedelta(days=2),
    )
    source, event = make_event("101")
    vanished_id = uuid.uuid7()
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([identity]),
        result_with_rows([(source, event)]),
        MagicMock(),
        result_with_scalars([vanished_id]),
        MagicMock(),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.return_value = [event_data("101")]

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown)

    assert response.status_code == 200
    body = response.json()
    assert body["events_created"] == 0
    assert body["events_updated"] == 1
    assert body["events_removed"] == 1
    assert event.venue_name == "Sphere"
    assert event.starts_at == datetime(2026, 10, 1, 20, 30, tzinfo=UTC)
    assert source.url == "https://www.bandsintown.com/e/101"
    session.add.assert_not_called()


async def test_sync_treats_unknown_artist_as_no_events() -> None:
    artist = Artist(id=uuid.uuid7(), name="Obscure Basement Band")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
        result_with_scalars([]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.side_effect = BandsintownArtistNotFoundError("nope")

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown)

    assert response.status_code == 200
    body = response.json()
    assert body["artists_unknown"] == 1
    assert body["artists_synced"] == 0
    identities = added_objects(session, BandsintownArtist)
    assert len(identities) == 1
    assert identities[0].last_synced_at is not None


async def test_sync_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request(
        "POST", SYNC_URL, session, bandsintown=AsyncMock(spec=BandsintownClient)
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


def make_matched_event(starts_at: datetime) -> Event:
    return Event(
        id=uuid.uuid7(),
        title=None,
        venue_name="MTELUS",
        venue_latitude=45.51,
        venue_longitude=-73.56,
        city_name="Montreal",
        region="QC",
        country="Canada",
        starts_at=starts_at,
    )


async def test_list_events_groups_artists_per_event() -> None:
    montreal = City(
        geonameid=6077243,
        name="Montréal",
        ascii_name="Montreal",
        admin1="Quebec",
        country_code="CA",
        latitude=45.50884,
        longitude=-73.58781,
        population=1600000,
    )
    user = MagicMock(city_id=montreal.geonameid)
    event1 = make_matched_event(datetime(2026, 8, 1, 20, 0, tzinfo=UTC))
    event2 = make_matched_event(datetime(2026, 8, 5, 20, 0, tzinfo=UTC))
    autechre = Artist(id=uuid.uuid7(), name="Autechre")
    boc = Artist(id=uuid.uuid7(), name="Boards of Canada")
    session = make_session()
    session.get.side_effect = [user, montreal]
    session.execute.return_value = result_with_rows(
        [
            (event1, autechre, "https://bandsintown.com/e/1", 2.9412),
            (event1, boc, "https://bandsintown.com/e/1", 2.9412),
            (event2, autechre, "https://bandsintown.com/e/2", 2.9412),
        ]
    )

    response = await request("GET", EVENTS_URL, session)

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert body[0]["event"]["venue_name"] == "MTELUS"
    assert body[0]["url"] == "https://bandsintown.com/e/1"
    assert body[0]["distance_km"] == 2.9
    assert [artist["name"] for artist in body[0]["artists"]] == ["Autechre", "Boards of Canada"]
    assert [artist["name"] for artist in body[1]["artists"]] == ["Autechre"]


async def test_list_events_requires_a_city() -> None:
    session = make_session()
    session.get.return_value = MagicMock(city_id=None)

    response = await request("GET", EVENTS_URL, session)

    assert response.status_code == 409
    assert response.json()["detail"] == "Set a city to match events"


async def test_list_events_unknown_user() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("GET", EVENTS_URL, session)

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"
