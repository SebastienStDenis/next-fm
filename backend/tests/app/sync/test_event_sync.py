import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from app.clients.ra import RaApiError, RaClient
from app.clients.source_events import SourceEventData
from app.clients.ticketmaster import TicketmasterApiError, TicketmasterClient
from app.core.models import Artist, Event, RaArtist, RaEvent, TicketmasterArtist, User
from app.sync.event_sync import _adopt, sync_user_events
from tests.helpers import (
    added_objects,
    make_session,
    result_returning,
    result_with_rows,
    result_with_scalars,
)

USER_ID = uuid.uuid7()


def user() -> User:
    return User(id=USER_ID, name="Alice", city_id=None, include_known_artists=False)


def event_data(
    external_id: str,
    starts_at: datetime | None = None,
    venue_name: str = "Sphere",
    latitude: float = 36.121217,
    longitude: float = -115.1620404,
    url: str = "https://tickets.example/e/",
    title: str | None = None,
    time_known: bool = True,
    richness: int = 0,
) -> SourceEventData:
    return SourceEventData(
        external_id=external_id,
        title=title,
        url=url + external_id,
        starts_at=starts_at or datetime(2026, 10, 1, 20, 30, tzinfo=UTC),
        time_known=time_known,
        richness=richness,
        lineup=["Metallica"],
        venue_name=venue_name,
        venue_latitude=latitude,
        venue_longitude=longitude,
        street_address=None,
        city_name="Las Vegas",
        region="NV",
        country="United States",
    )


def stored_event(
    starts_at: datetime | None = None,
    venue_name: str = "Sphere",
    latitude: float = 36.121217,
    longitude: float = -115.1620404,
) -> Event:
    return Event(
        id=uuid.uuid7(),
        title="Stored title",
        venue_name=venue_name,
        venue_latitude=latitude,
        venue_longitude=longitude,
        city_name="Las Vegas",
        region="NV",
        country="United States",
        starts_at=starts_at or datetime(2026, 10, 1, 20, 30, tzinfo=UTC),
    )


def fresh(identity: TicketmasterArtist | RaArtist) -> TicketmasterArtist | RaArtist:
    identity.last_synced_at = datetime.now(UTC)
    return identity


def make_clients(
    tm_events: list[SourceEventData] | Exception | None = None,
    ra_events: list[SourceEventData] | Exception | None = None,
    tm_resolved: str | None = "TM-A1",
    ra_resolved: str | None = "966",
) -> tuple[AsyncMock, AsyncMock]:
    ticketmaster = AsyncMock(spec=TicketmasterClient)
    ticketmaster.find_attraction_id.return_value = tm_resolved
    if isinstance(tm_events, Exception):
        ticketmaster.get_attraction_events.side_effect = tm_events
    else:
        ticketmaster.get_attraction_events.return_value = tm_events or []
    ra = AsyncMock(spec=RaClient)
    ra.find_artist_id.return_value = ra_resolved
    if isinstance(ra_events, Exception):
        ra.get_artist_events.side_effect = ra_events
    else:
        ra.get_artist_events.return_value = ra_events or []
    return ticketmaster, ra


async def test_sync_creates_events_for_new_artist() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    tm_identity = TicketmasterArtist(artist_id=artist.id, name="Metallica")
    ra_identity = RaArtist(artist_id=artist.id, name="Metallica")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([]),  # tm identities
        MagicMock(),  # tm identity insert
        result_returning(tm_identity),  # tm identity select
        result_with_rows([]),  # tm existing source rows
        result_with_scalars([]),  # tm adoption candidates
        result_with_rows([]),  # tm source-row insert returning
        MagicMock(),  # tm event_artists insert
        result_with_rows([]),  # tm prune
        result_with_scalars([]),  # ra identities
        MagicMock(),  # ra identity insert
        result_returning(ra_identity),  # ra identity select
        result_returning(2),  # events_total
    ]
    ticketmaster, ra = make_clients(
        tm_events=[
            event_data("101"),
            event_data("102", starts_at=datetime(2026, 10, 3, 20, 30, tzinfo=UTC)),
        ],
        ra_resolved=None,
    )

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert [event.venue_name for event in added_objects(session, Event)] == ["Sphere", "Sphere"]
    assert result.artists_total == 1
    assert result.artists_synced == 1  # TM synced outranks RA unknown
    assert result.artists_unknown == 0
    assert result.events_created == 2
    assert result.events_total == 2
    assert tm_identity.external_id == "TM-A1"
    assert tm_identity.last_synced_at is not None
    assert ra_identity.external_id is None
    assert ra_identity.last_synced_at is not None  # unknown retries only after the TTL
    ra.get_artist_events.assert_not_awaited()


async def test_ra_record_of_a_ticketmaster_event_merges_without_touching_fields() -> None:
    artist = Artist(id=uuid.uuid7(), name="Ben Klock")
    tm_identity = fresh(TicketmasterArtist(artist_id=artist.id, name="Ben Klock", external_id="T1"))
    ra_identity = RaArtist(artist_id=artist.id, name="Ben Klock", external_id="966")
    tm_event = stored_event(starts_at=datetime(2026, 10, 1, 19, 0, tzinfo=UTC))
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities (fresh -> skipped)
        result_with_scalars([ra_identity]),  # ra identities
        result_with_rows([]),  # ra existing source rows
        result_with_scalars([tm_event]),  # ra adoption candidates
        result_with_scalars([]),  # candidates' existing ra rows
        result_with_scalars([tm_event.id]),  # outranked (has a tm row)
        result_with_rows([]),  # ra source-row insert returning
        MagicMock(),  # ra event_artists insert
        result_with_rows([]),  # ra prune
        result_returning(1),  # events_total
    ]
    same_show = event_data(
        "RA-9", starts_at=datetime(2026, 10, 1, 23, 0, tzinfo=UTC), venue_name="Sphere Las Vegas"
    )
    ticketmaster, ra = make_clients(ra_events=[same_show])

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert added_objects(session, Event) == []  # adopted, not duplicated
    assert tm_event.title == "Stored title"  # ticketmaster owns the display fields
    assert result.events_created == 0
    assert result.events_updated == 1
    assert result.artists_synced == 1
    assert result.artists_skipped == 0
    ticketmaster.get_attraction_events.assert_not_awaited()


async def test_ra_owns_fields_of_events_without_ticketmaster_row() -> None:
    artist = Artist(id=uuid.uuid7(), name="Ben Klock")
    tm_identity = fresh(TicketmasterArtist(artist_id=artist.id, name="Ben Klock", external_id="T1"))
    ra_identity = RaArtist(artist_id=artist.id, name="Ben Klock", external_id="966")
    event = stored_event()
    ra_row = RaEvent(id=uuid.uuid7(), event_id=event.id, external_id="RA-9")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities (fresh -> skipped)
        result_with_scalars([ra_identity]),  # ra identities
        result_with_rows([(ra_row, event)]),  # ra existing source rows
        result_with_scalars([]),  # outranked (no tm row)
        MagicMock(),  # ra event_artists insert
        result_with_rows([]),  # ra prune
        result_returning(1),  # events_total
    ]
    update = event_data("RA-9", venue_name="Berghain", url="https://ra.co/events/")
    ticketmaster, ra = make_clients(ra_events=[update])

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert event.venue_name == "Berghain"
    assert ra_row.url == "https://ra.co/events/RA-9"
    assert result.events_updated == 1


async def test_prune_deletes_only_events_with_no_remaining_source() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    tm_identity = TicketmasterArtist(artist_id=artist.id, name="Metallica", external_id="T1")
    ra_identity = fresh(RaArtist(artist_id=artist.id, name="Metallica", external_id="966"))
    orphan_id, shared_id = uuid.uuid7(), uuid.uuid7()
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities
        result_with_rows([(uuid.uuid7(), orphan_id), (uuid.uuid7(), shared_id)]),  # tm prune
        MagicMock(),  # delete tm source rows
        result_with_scalars([]),  # still sourced by ticketmaster
        result_with_scalars([shared_id]),  # still sourced by ra
        MagicMock(),  # delete orphaned events
        result_with_scalars([ra_identity]),  # ra identities (fresh -> skipped)
        result_returning(0),  # events_total
    ]
    ticketmaster, ra = make_clients(tm_events=[])

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert result.events_removed == 1
    assert result.artists_synced == 1


async def test_failed_source_leaves_last_synced_for_retry() -> None:
    artist = Artist(id=uuid.uuid7(), name="Ben Klock")
    tm_identity = TicketmasterArtist(artist_id=artist.id, name="Ben Klock", external_id="T1")
    ra_identity = RaArtist(artist_id=artist.id, name="Ben Klock", external_id="966")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities
        result_with_scalars([ra_identity]),  # ra identities
        result_with_rows([]),  # ra existing source rows
        result_with_scalars([]),  # ra adoption candidates
        result_with_rows([]),  # ra source-row insert returning
        MagicMock(),  # ra event_artists insert
        result_with_rows([]),  # ra prune
        result_returning(1),  # events_total
    ]
    ticketmaster, ra = make_clients(
        tm_events=TicketmasterApiError(429, "rate limited"), ra_events=[event_data("RA-9")]
    )

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert tm_identity.last_synced_at is None  # retried next sync
    assert ra_identity.last_synced_at is not None
    assert result.artists_synced == 1  # RA synced outranks TM failed
    assert result.artists_failed == 0
    assert result.events_created == 1


async def test_both_sources_failing_reports_failure() -> None:
    artist = Artist(id=uuid.uuid7(), name="Ben Klock")
    tm_identity = TicketmasterArtist(artist_id=artist.id, name="Ben Klock", external_id="T1")
    ra_identity = RaArtist(artist_id=artist.id, name="Ben Klock", external_id="966")
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities
        result_with_scalars([ra_identity]),  # ra identities
        result_returning(0),  # events_total
    ]
    ticketmaster, ra = make_clients(
        tm_events=TicketmasterApiError(500, "boom"), ra_events=RaApiError(403, "blocked")
    )

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert result.artists_failed == 1
    assert result.artists_synced == 0


async def test_fresh_identities_skip_both_sources() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    tm_identity = fresh(TicketmasterArtist(artist_id=artist.id, name="Metallica", external_id="T1"))
    ra_identity = fresh(RaArtist(artist_id=artist.id, name="Metallica", external_id="966"))
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities
        result_with_scalars([ra_identity]),  # ra identities
        result_returning(5),  # events_total
    ]
    ticketmaster, ra = make_clients()

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert result.artists_skipped == 1
    assert result.artists_synced == 0
    assert result.events_total == 5
    ticketmaster.get_attraction_events.assert_not_awaited()
    ra.get_artist_events.assert_not_awaited()


async def test_no_interest_artists() -> None:
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([]),  # interest artists
        result_with_scalars([]),  # tm identities
        result_with_scalars([]),  # ra identities
        result_returning(0),  # events_total
    ]
    ticketmaster, ra = make_clients()

    result = await sync_user_events(session, ticketmaster, ra, user())

    assert result.artists_total == 0
    assert result.events_created == 0


def test_adopt_matches_by_venue_name_when_coordinates_differ() -> None:
    stored = stored_event(latitude=0.0, longitude=0.0, venue_name=" SPHERE ")
    data = event_data("X1")
    assert _adopt(data, {stored.starts_at.date(): [stored]}, set()) is stored


def test_adopt_merges_same_source_records_only_at_the_same_time() -> None:
    stored = stored_event(starts_at=datetime(2026, 10, 1, 20, 30, tzinfo=UTC))
    candidates = {stored.starts_at.date(): [stored]}
    same_time = event_data("X1", starts_at=datetime(2026, 10, 1, 20, 30, tzinfo=UTC))
    late_show = event_data("X2", starts_at=datetime(2026, 10, 1, 23, 0, tzinfo=UTC))
    timeless = event_data("X3", starts_at=datetime(2026, 10, 1, tzinfo=UTC), time_known=False)
    assert _adopt(same_time, candidates, {stored.id}) is stored
    assert _adopt(late_show, candidates, {stored.id}) is None
    assert _adopt(timeless, candidates, {stored.id}) is stored
    # Across sources the time is free to differ.
    assert _adopt(late_show, candidates, set()) is stored


def test_adopt_prefers_nearest_start_time_for_double_shows() -> None:
    early = stored_event(starts_at=datetime(2026, 10, 1, 19, 0, tzinfo=UTC))
    late = stored_event(starts_at=datetime(2026, 10, 1, 23, 0, tzinfo=UTC))
    data = event_data("X1", starts_at=datetime(2026, 10, 1, 22, 30, tzinfo=UTC))
    assert _adopt(data, {early.starts_at.date(): [early, late]}, set()) is late


def test_adopt_ignores_other_dates_and_places() -> None:
    other_day = stored_event(starts_at=datetime(2026, 10, 2, 20, 30, tzinfo=UTC))
    other_place = stored_event(venue_name="Elsewhere", latitude=40.7, longitude=-73.9)
    data = event_data("X1")
    candidates = {
        other_day.starts_at.date(): [other_day],
        data.starts_at.date(): [other_place],
    }
    assert _adopt(data, candidates, set()) is None


async def test_ticketmaster_ticket_products_collapse_onto_one_show() -> None:
    artist = Artist(id=uuid.uuid7(), name="Metallica")
    tm_identity = TicketmasterArtist(artist_id=artist.id, name="Metallica", external_id="T1")
    ra_identity = fresh(RaArtist(artist_id=artist.id, name="Metallica", external_id="966"))
    session = make_session()
    session.execute.side_effect = [
        result_with_scalars([artist]),  # interest artists
        result_with_scalars([tm_identity]),  # tm identities
        result_with_rows([]),  # tm existing source rows
        result_with_scalars([]),  # tm adoption candidates
        result_with_rows([]),  # tm source-row insert returning
        MagicMock(),  # tm event_artists insert
        result_with_rows([]),  # tm prune
        result_with_scalars([ra_identity]),  # ra identities (fresh -> skipped)
        result_returning(2),  # events_total
    ]
    show = datetime(2026, 10, 1, 20, 30, tzinfo=UTC)
    ticketmaster, ra = make_clients(
        tm_events=[
            # Feed order is adversarial: the primary listing comes last and
            # sorts last by id, so only preference ordering makes it win.
            event_data(
                "A-pass",
                starts_at=show.replace(hour=0, minute=0),
                time_known=False,
                richness=3,
                title="2-Day Ticket",
            ),
            event_data("B-suite", starts_at=show, title="Metallica - Suite Reservation"),
            event_data("C-late", starts_at=show.replace(hour=23), title="Late show"),
            event_data("D-main", starts_at=show, richness=3, title="Metallica: Life Burns Faster"),
        ]
    )

    result = await sync_user_events(session, ticketmaster, ra, user())

    events = added_objects(session, Event)
    assert [(event.title, event.starts_at.hour) for event in events] == [
        ("Metallica: Life Burns Faster", 20),
        ("Late show", 23),
    ]
    assert result.events_created == 2
    assert result.events_updated == 2  # suite + pass attached to the main show
