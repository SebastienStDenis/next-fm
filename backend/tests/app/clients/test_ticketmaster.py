from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from app.clients.ticketmaster import (
    TicketmasterApiError,
    TicketmasterClient,
    _parse_event,
    _parse_start,
)


def event_payload(**overrides: object) -> dict:
    payload = {
        "id": "vvG1zZ9pqcAKdN",
        "name": "Metallica: M72 World Tour",
        "url": "https://www.ticketmaster.com/event/vvG1zZ9pqcAKdN",
        "dates": {
            "start": {"localDate": "2026-10-01", "localTime": "20:30:00"},
            "status": {"code": "onsale"},
        },
        "_embedded": {
            "venues": [
                {
                    "name": "Sphere",
                    "city": {"name": "Las Vegas"},
                    "state": {"stateCode": "NV"},
                    "country": {"name": "United States Of America"},
                    "address": {"line1": "255 Sands Ave"},
                    "location": {"latitude": "36.121217", "longitude": "-115.1620404"},
                }
            ],
            "attractions": [{"name": "Metallica"}, {"name": "Pantera"}],
        },
    }
    payload.update(overrides)
    return payload


def attraction_event(external_id: str, *attraction_ids: str) -> dict:
    payload = event_payload(id=external_id)
    payload["_embedded"]["attractions"] = [
        {"id": attraction_id, "name": attraction_id} for attraction_id in attraction_ids
    ]
    return payload


def test_parse_event_maps_fields() -> None:
    data = _parse_event(event_payload())
    assert data is not None
    assert data.external_id == "vvG1zZ9pqcAKdN"
    assert data.title == "Metallica: M72 World Tour"
    assert data.url == "https://www.ticketmaster.com/event/vvG1zZ9pqcAKdN"
    assert data.starts_at == datetime(2026, 10, 1, 20, 30, tzinfo=UTC)
    assert data.time_known is True
    assert data.richness == 0
    assert data.lineup == ["Metallica", "Pantera"]
    assert data.venue_name == "Sphere"
    assert data.venue_latitude == 36.121217
    assert data.venue_longitude == -115.1620404
    assert data.street_address == "255 Sands Ave"
    assert data.city_name == "Las Vegas"
    assert data.region == "NV"
    assert data.country == "United States Of America"


def test_parse_event_skips_cancelled() -> None:
    payload = event_payload(
        dates={
            "start": {"localDate": "2026-10-01", "localTime": "20:30:00"},
            "status": {"code": "cancelled"},
        }
    )
    assert _parse_event(payload) is None


def test_parse_event_drops_missing_venue_coordinates() -> None:
    payload = event_payload()
    payload["_embedded"]["venues"][0].pop("location")
    assert _parse_event(payload) is None


def test_parse_event_drops_missing_date() -> None:
    assert _parse_event(event_payload(dates={})) is None


def test_parse_start_without_time_is_midnight() -> None:
    assert _parse_start({"localDate": "2026-10-01"}) == datetime(2026, 10, 1, tzinfo=UTC)


def test_parse_event_scores_richness_of_the_primary_listing() -> None:
    payload = event_payload(
        sales={"public": {}, "presales": [{"name": "Fan presale"}]},
        seatmap={"staticUrl": "https://maps.example/sphere.png"},
        products=[{"name": "Sphere Parking (Metallica)"}],
    )
    data = _parse_event(payload)
    assert data is not None
    assert data.richness == 3


def test_parse_event_without_specific_time_is_not_time_known() -> None:
    payload = event_payload(
        dates={"start": {"localDate": "2026-10-01", "noSpecificTime": True}, "status": {}}
    )
    data = _parse_event(payload)
    assert data is not None
    assert data.starts_at == datetime(2026, 10, 1, tzinfo=UTC)
    assert data.time_known is False


async def test_find_attraction_id_requires_exact_name_match() -> None:
    client = TicketmasterClient("key")
    client._get = AsyncMock(
        return_value={
            "_embedded": {
                "attractions": [
                    {"id": "K1", "name": "Metallica Tribute"},
                    {"id": "K2", "name": " METALLICA "},
                ]
            }
        }
    )
    assert await client.find_attraction_id("Metallica") == "K2"


async def test_find_attraction_id_without_match_is_none() -> None:
    client = TicketmasterClient("key")
    client._get = AsyncMock(
        return_value={"_embedded": {"attractions": [{"id": "K1", "name": "Other"}]}}
    )
    assert await client.find_attraction_id("Metallica") is None


async def test_find_attraction_ids_isolates_per_artist_errors() -> None:
    client = TicketmasterClient("key")
    client.find_attraction_id = AsyncMock(
        side_effect=["K1", TicketmasterApiError(500, "boom"), None]
    )

    results = await client.find_attraction_ids(["One", "Two", "Three"])

    assert results[0] == "K1"
    assert isinstance(results[1], TicketmasterApiError)
    assert results[2] is None


async def test_get_attraction_events_walks_pages() -> None:
    client = TicketmasterClient("key")
    client._get = AsyncMock(
        side_effect=[
            {
                "_embedded": {"events": [event_payload()]},
                "page": {"totalPages": 2},
            },
            {
                "_embedded": {"events": [event_payload(id="second")]},
                "page": {"totalPages": 2},
            },
        ]
    )
    events = await client.get_attraction_events("K2")
    assert [event.external_id for event in events] == ["vvG1zZ9pqcAKdN", "second"]


async def test_get_attractions_events_maps_shared_events_and_walks_pages() -> None:
    client = TicketmasterClient("key")
    client._get = AsyncMock(
        side_effect=[
            {
                "_embedded": {
                    "events": [
                        attraction_event("one", "K1"),
                        attraction_event("shared", "K1", "K2"),
                    ]
                },
                "page": {"totalElements": 3, "totalPages": 2},
            },
            {
                "_embedded": {"events": [attraction_event("two", "K2")]},
                "page": {"totalElements": 3, "totalPages": 2},
            },
        ]
    )

    results = await client.get_attractions_events(["K1", "K2"])

    assert [
        [event.external_id for event in events] for events in results if isinstance(events, list)
    ] == [
        ["one", "shared"],
        ["shared", "two"],
    ]
    assert client._get.await_args_list[0].args[1]["attractionId"] == "K1,K2"


async def test_get_attractions_events_splits_batches_over_paging_limit() -> None:
    client = TicketmasterClient("key")
    client._get = AsyncMock(
        side_effect=[
            {"page": {"totalElements": 1001, "totalPages": 6}},
            {
                "_embedded": {"events": [attraction_event("one", "K1")]},
                "page": {"totalElements": 1, "totalPages": 1},
            },
            {
                "_embedded": {"events": [attraction_event("two", "K2")]},
                "page": {"totalElements": 1, "totalPages": 1},
            },
        ]
    )

    results = await client.get_attractions_events(["K1", "K2"])

    assert [
        [event.external_id for event in events] for events in results if isinstance(events, list)
    ] == [
        ["one"],
        ["two"],
    ]
    assert [call.args[1]["attractionId"] for call in client._get.await_args_list] == [
        "K1,K2",
        "K1",
        "K2",
    ]


async def test_get_attractions_events_preserves_successful_split_half() -> None:
    client = TicketmasterClient("key")
    client._get = AsyncMock(
        side_effect=[
            {"page": {"totalElements": 1001, "totalPages": 6}},
            {
                "_embedded": {"events": [attraction_event("one", "K1")]},
                "page": {"totalElements": 1, "totalPages": 1},
            },
            TicketmasterApiError(500, "boom"),
        ]
    )

    results = await client.get_attractions_events(["K1", "K2"])

    assert not isinstance(results[0], TicketmasterApiError)
    assert [event.external_id for event in results[0]] == ["one"]
    assert isinstance(results[1], TicketmasterApiError)


async def test_get_attractions_events_preserves_alignment_through_nested_splits() -> None:
    client = TicketmasterClient("key")

    async def get(path: str, params: dict) -> dict:
        attraction_ids = params["attractionId"]
        if attraction_ids == "K1,K2,K3,K4":
            return {
                "_embedded": {"events": [attraction_event("unattributed", "other")]},
                "page": {"totalElements": 1, "totalPages": 1},
            }
        if attraction_ids == "K1,K2":
            return {"page": {"totalElements": 1001, "totalPages": 6}}
        if attraction_ids == "K1":
            return {
                "_embedded": {"events": [attraction_event("one", "K1")]},
                "page": {"totalElements": 1, "totalPages": 1},
            }
        if attraction_ids == "K2":
            raise TicketmasterApiError(500, "boom")
        return {
            "_embedded": {
                "events": [attraction_event("three", "K3"), attraction_event("four", "K4")]
            },
            "page": {"totalElements": 2, "totalPages": 1},
        }

    client._get = AsyncMock(side_effect=get)

    results = await client.get_attractions_events(["K1", "K2", "K3", "K4"])

    assert not isinstance(results[0], TicketmasterApiError)
    assert [event.external_id for event in results[0]] == ["one"]
    assert isinstance(results[1], TicketmasterApiError)
    assert not isinstance(results[2], TicketmasterApiError)
    assert [event.external_id for event in results[2]] == ["three"]
    assert not isinstance(results[3], TicketmasterApiError)
    assert [event.external_id for event in results[3]] == ["four"]


async def test_rate_limit_is_retried_after_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    statuses = iter([429, 429, 200])
    slept: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        status = next(statuses)
        if status == 429:
            return httpx.Response(429, headers={"Retry-After": "2"}, text="Rate limit exceeded")
        return httpx.Response(200, json={"_embedded": {"events": []}, "page": {"totalPages": 1}})

    async def sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr("app.clients.ticketmaster.asyncio.sleep", sleep)
    client = TicketmasterClient("key")
    client._http = httpx.AsyncClient(
        base_url="https://app.ticketmaster.com/discovery/v2",
        transport=httpx.MockTransport(handler),
    )
    assert await client.get_attraction_events("K2") == []
    assert slept == [2.0, 2.0]


async def test_persistent_rate_limit_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429, text="Rate limit exceeded")

    async def sleep(seconds: float) -> None:
        pass

    monkeypatch.setattr("app.clients.ticketmaster.asyncio.sleep", sleep)
    client = TicketmasterClient("key")
    client._http = httpx.AsyncClient(
        base_url="https://app.ticketmaster.com/discovery/v2",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(TicketmasterApiError) as exc_info:
        await client.get_attraction_events("K2")
    assert exc_info.value.status_code == 429
    assert calls == 3


async def test_api_error_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal error")

    client = TicketmasterClient("key")
    client._http = httpx.AsyncClient(
        base_url="https://app.ticketmaster.com/discovery/v2",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(TicketmasterApiError) as exc_info:
        await client.get_attraction_events("K2")
    assert exc_info.value.status_code == 500
