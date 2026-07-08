import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from app.bandsintown import (
    BandsintownApiError,
    BandsintownArtistNotFoundError,
    BandsintownClient,
    BandsintownEventData,
)
from app.models import Artist, BandsintownArtist, BandsintownEvent, City, Event, User
from tests.helpers import (
    added_objects,
    make_session,
    request,
    result_returning,
    result_with_rows,
    result_with_scalars,
)

USER_ID = uuid.uuid7()
SYNC_URL = "/me/events/sync"
EVENTS_URL = "/me/events"


def user(city_id: int | None = None) -> User:
    return User(id=USER_ID, name="Alice", city_id=city_id, include_known_artists=False)


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


async def test_sync_creates_events_for_new_artist() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    identity = BandsintownArtist(artist_id=artist.id, name="Metallica")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
        MagicMock(),
        result_returning(identity),
        result_with_rows([]),
        result_with_rows([]),
        MagicMock(),
        result_with_scalars([]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.return_value = [event_data("101"), event_data("102")]

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

    assert response.status_code == 200
    body = response.json()
    assert body["artists_total"] == 1
    assert body["artists_synced"] == 1
    assert body["artists_skipped"] == 0
    assert body["artists_unknown"] == 0
    assert body["artists_failed"] == 0
    assert body["events_created"] == 2
    assert body["events_updated"] == 0
    assert body["events_removed"] == 0
    bandsintown.get_artist_events.assert_awaited_once_with("Metallica")

    events = added_objects(session, Event)
    assert len(events) == 2
    assert events[0].venue_name == "Sphere"
    assert identity.external_id == "128"
    assert identity.last_synced_at is not None
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

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

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

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

    assert response.status_code == 200
    body = response.json()
    assert body["events_created"] == 0
    assert body["events_updated"] == 1
    assert body["events_removed"] == 1
    assert event.venue_name == "Sphere"
    assert event.starts_at == datetime(2026, 10, 1, 20, 30, tzinfo=UTC)
    assert source.url == "https://www.bandsintown.com/e/101"
    session.add.assert_not_called()


async def test_sync_dedupes_repeated_external_ids_in_one_feed() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    identity = BandsintownArtist(artist_id=artist.id, name="Metallica")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
        MagicMock(),
        result_returning(identity),
        result_with_rows([]),
        result_with_rows([]),
        MagicMock(),
        result_with_scalars([]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.return_value = [event_data("101"), event_data("101")]

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

    assert response.status_code == 200
    assert response.json()["events_created"] == 1
    assert len(added_objects(session, Event)) == 1


async def test_sync_adopts_event_created_by_concurrent_sync() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    identity = BandsintownArtist(artist_id=artist.id, name="Metallica")
    adopted_event_id = uuid.uuid7()
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
        MagicMock(),
        result_returning(identity),
        result_with_rows([]),
        result_with_rows([("101", adopted_event_id)]),
        MagicMock(),
        result_with_scalars([]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.return_value = [event_data("101")]

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

    assert response.status_code == 200
    body = response.json()
    assert body["events_created"] == 0
    assert body["events_updated"] == 1
    duplicate = added_objects(session, Event)[0]
    session.delete.assert_awaited_once_with(duplicate)


async def test_sync_treats_unknown_artist_as_no_events() -> None:
    artist = Artist(id=uuid.uuid7(), name="Obscure Basement Band")
    identity = BandsintownArtist(artist_id=artist.id, name="Obscure Basement Band")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
        MagicMock(),
        result_returning(identity),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.side_effect = BandsintownArtistNotFoundError("nope")

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

    assert response.status_code == 200
    body = response.json()
    assert body["artists_unknown"] == 1
    assert body["artists_synced"] == 0
    assert body["events_removed"] == 0
    assert identity.last_synced_at is not None
    # Not-found never triggers vanish-deletion, so no further queries run.
    assert session.execute.await_count == 4


async def test_sync_counts_api_errors_and_leaves_artist_retryable() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),
        result_with_scalars([]),
    ]
    bandsintown = AsyncMock(spec=BandsintownClient)
    bandsintown.get_artist_events.side_effect = BandsintownApiError(200, "{warn=Not found}")

    response = await request("POST", SYNC_URL, session, bandsintown=bandsintown, user=user())

    assert response.status_code == 200
    body = response.json()
    assert body["artists_failed"] == 1
    assert body["artists_synced"] == 0
    assert body["events_removed"] == 0
    # No identity row is written, so the artist is retried on the next sync.
    assert session.execute.await_count == 2
    session.commit.assert_awaited_once()


async def test_sync_requires_authentication() -> None:
    session = make_session()

    response = await request(
        "POST", SYNC_URL, session, bandsintown=AsyncMock(spec=BandsintownClient)
    )

    assert response.status_code == 401


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
    event1 = make_matched_event(datetime(2026, 8, 1, 20, 0, tzinfo=UTC))
    event2 = make_matched_event(datetime(2026, 8, 5, 20, 0, tzinfo=UTC))
    autechre = Artist(id=uuid.uuid7(), name="Autechre")
    boc = Artist(id=uuid.uuid7(), name="Boards of Canada")
    session = make_session()
    session.get.return_value = montreal
    session.execute.return_value = result_with_rows(
        [
            (event1, autechre, "https://bandsintown.com/e/1", 2.9412),
            (event1, boc, "https://bandsintown.com/e/1", 2.9412),
            (event2, autechre, "https://bandsintown.com/e/2", 2.9412),
        ]
    )

    response = await request("GET", EVENTS_URL, session, user=user(montreal.geonameid))

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

    response = await request("GET", EVENTS_URL, session, user=user(None))

    assert response.status_code == 409
    assert response.json()["detail"] == "Set a city to match events"


async def test_list_events_requires_authentication() -> None:
    session = make_session()

    response = await request("GET", EVENTS_URL, session)

    assert response.status_code == 401


async def test_list_events_accepts_an_explicit_city() -> None:
    seattle = City(
        geonameid=5809844,
        name="Seattle",
        ascii_name="Seattle",
        admin1="Washington",
        country_code="US",
        latitude=47.60621,
        longitude=-122.33207,
        population=737015,
    )
    event = make_matched_event(datetime(2026, 8, 1, 20, 0, tzinfo=UTC))
    artist = Artist(id=uuid.uuid7(), name="Autechre")
    session = make_session()
    session.get.return_value = seattle
    session.execute.return_value = result_with_rows(
        [(event, artist, "https://bandsintown.com/e/1", 12.0)]
    )

    response = await request(
        "GET", f"{EVENTS_URL}?geonameid={seattle.geonameid}", session, user=user(None)
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    session.get.assert_any_await(City, seattle.geonameid)


async def test_list_events_unknown_explicit_city() -> None:
    session = make_session()
    session.get.return_value = None

    response = await request("GET", f"{EVENTS_URL}?geonameid=999", session, user=user(None))

    assert response.status_code == 404
    assert response.json()["detail"] == "City not found"
