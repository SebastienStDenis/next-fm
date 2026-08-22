from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from app.clients.ra import RaApiError, RaClient, _parse_event


def event_payload(**overrides: object) -> dict:
    payload = {
        "id": "2329592",
        "title": "Klubnacht",
        "startTime": "2026-09-19T23:59:00.000",
        "contentUrl": "/events/2329592",
        "artists": [{"name": "Ben Klock"}, {"name": "Marcel Dettmann"}],
        "venue": {
            "name": "Berghain",
            "address": "Am Wriezener Bahnhof, 10243 Berlin",
            "location": {"latitude": 52.511118, "longitude": 13.443025},
            "area": {"name": "Berlin", "country": {"name": "Germany"}},
        },
    }
    payload.update(overrides)
    return payload


def test_parse_event_maps_fields() -> None:
    data = _parse_event(event_payload())
    assert data is not None
    assert data.external_id == "2329592"
    assert data.title == "Klubnacht"
    assert data.url == "https://ra.co/events/2329592"
    assert data.starts_at == datetime(2026, 9, 19, 23, 59, tzinfo=UTC)
    assert data.time_known is True
    assert data.richness == 0
    assert data.lineup == ["Ben Klock", "Marcel Dettmann"]
    assert data.venue_name == "Berghain"
    assert data.venue_latitude == 52.511118
    assert data.venue_longitude == 13.443025
    assert data.street_address == "Am Wriezener Bahnhof, 10243 Berlin"
    assert data.city_name == "Berlin"
    assert data.region is None
    assert data.country == "Germany"


def test_parse_event_drops_tba_venue_at_null_island() -> None:
    payload = event_payload(
        venue={
            "name": "TBA",
            "address": None,
            "location": {"latitude": 0, "longitude": 0},
            "area": {"name": "Thessaloniki", "country": {"name": "Greece"}},
        }
    )
    assert _parse_event(payload) is None


def test_parse_event_drops_missing_venue() -> None:
    assert _parse_event(event_payload(venue=None)) is None


async def test_find_artist_id_requires_exact_name_match() -> None:
    client = RaClient()
    client._query = AsyncMock(
        return_value={
            "search": [
                {"id": "1", "value": "Ben Klock Tribute"},
                {"id": "966", "value": "ben klock"},
            ]
        }
    )
    assert await client.find_artist_id("Ben Klock") == "966"


async def test_find_artist_id_without_match_is_none() -> None:
    client = RaClient()
    client._query = AsyncMock(return_value={"search": []})
    assert await client.find_artist_id("Ben Klock") is None


async def test_get_artist_events_for_vanished_artist_is_empty() -> None:
    client = RaClient()
    client._query = AsyncMock(return_value={"artist": None})
    assert await client.get_artist_events("966") == []


async def test_graphql_errors_raise() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"errors": [{"message": "Something went wrong"}], "data": None}
        )

    client = RaClient()
    client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(RaApiError, match="Something went wrong"):
        await client.get_artist_events("966")


async def test_http_error_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="blocked")

    client = RaClient()
    client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(RaApiError) as exc_info:
        await client.find_artist_id("Ben Klock")
    assert exc_info.value.status_code == 403
