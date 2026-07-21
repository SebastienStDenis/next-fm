from datetime import UTC, datetime

import httpx
import pytest

from app.clients.bandsintown import (
    BandsintownApiError,
    BandsintownArtistNotFoundError,
    BandsintownClient,
    _encode_artist_name,
    _parse_event,
)

VENUE = {
    "name": "Sphere",
    "city": "Las Vegas",
    "region": "NV",
    "country": "United States",
    "latitude": "36.121217",
    "longitude": "-115.1620404",
    "location": "Las Vegas, NV",
    "street_address": "255 Sands Ave",
}

EVENT = {
    "id": "108007093",
    "artist_id": "128",
    "title": "",
    "url": "https://www.bandsintown.com/e/108007093",
    "datetime": "2026-10-01T20:30:00",
    "lineup": ["Metallica"],
    "venue": VENUE,
}


def test_parse_event_maps_fields() -> None:
    data = _parse_event(EVENT)

    assert data is not None
    assert data.external_id == "108007093"
    assert data.artist_external_id == "128"
    assert data.title is None
    assert data.url == "https://www.bandsintown.com/e/108007093"
    assert data.starts_at == datetime(2026, 10, 1, 20, 30, tzinfo=UTC)
    assert data.lineup == ["Metallica"]
    assert data.venue_name == "Sphere"
    assert data.venue_latitude == pytest.approx(36.121217)
    assert data.venue_longitude == pytest.approx(-115.1620404)
    assert data.street_address == "255 Sands Ave"
    assert data.city_name == "Las Vegas"
    assert data.region == "NV"
    assert data.country == "United States"


def test_parse_event_keeps_title_and_falls_back_to_location() -> None:
    venue = {**VENUE, "city": "", "region": "", "country": ""}
    data = _parse_event({**EVENT, "title": "M72 World Tour", "venue": venue})

    assert data is not None
    assert data.title == "M72 World Tour"
    assert data.city_name == "Las Vegas, NV"
    assert data.region is None
    assert data.country is None


def test_parse_event_skips_unusable_events() -> None:
    assert _parse_event({**EVENT, "id": ""}) is None
    assert _parse_event({**EVENT, "datetime": ""}) is None
    assert _parse_event({**EVENT, "datetime": "not-a-date"}) is None
    assert _parse_event({**EVENT, "venue": {**VENUE, "name": ""}}) is None
    assert _parse_event({**EVENT, "venue": {**VENUE, "latitude": ""}}) is None
    assert _parse_event({**EVENT, "venue": {**VENUE, "longitude": None}}) is None


def test_parse_event_labels_wall_clock_as_utc_even_with_offset() -> None:
    data = _parse_event({**EVENT, "datetime": "2026-10-01T20:30:00+02:00"})

    assert data is not None
    assert data.starts_at == datetime(2026, 10, 1, 20, 30, tzinfo=UTC)


def test_encode_artist_name_double_encodes_reserved_characters() -> None:
    assert _encode_artist_name("Metallica") == "Metallica"
    assert _encode_artist_name("Florence + The Machine") == "Florence%20%2B%20The%20Machine"
    assert _encode_artist_name("AC/DC") == "AC%252FDC"
    assert _encode_artist_name("Panic? At The Disco") == "Panic%253F%20At%20The%20Disco"
    assert _encode_artist_name("E*MO*TION") == "E%252AMO%252ATION"


def stub_bandsintown_api(
    monkeypatch: pytest.MonkeyPatch, status_code: int, payload: object, text: str | None = None
) -> None:
    async def get(self: httpx.AsyncClient, url: str, params: dict | None = None) -> httpx.Response:
        request = httpx.Request("GET", url)
        if text is not None:
            return httpx.Response(status_code, text=text, request=request)
        return httpx.Response(status_code, json=payload, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "get", get)


async def test_get_artist_events_parses_and_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_bandsintown_api(monkeypatch, 200, [EVENT, {**EVENT, "id": ""}])

    events = await BandsintownClient("app-id").get_artist_events("Metallica")

    assert len(events) == 1
    assert events[0].external_id == "108007093"


async def test_get_artist_events_raises_on_unknown_artist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_bandsintown_api(monkeypatch, 404, {"errorMessage": "[NotFound] The artist was not found"})

    with pytest.raises(BandsintownArtistNotFoundError):
        await BandsintownClient("app-id").get_artist_events("zzz")


async def test_get_artist_events_raises_on_api_error(monkeypatch: pytest.MonkeyPatch) -> None:
    stub_bandsintown_api(monkeypatch, 403, {"message": "invalid app_id"})

    with pytest.raises(BandsintownApiError):
        await BandsintownClient("bad").get_artist_events("Metallica")


async def test_get_artist_events_treats_invalid_name_as_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_bandsintown_api(monkeypatch, 401, None, text="\n\n{message=invalid parameter}\n")

    with pytest.raises(BandsintownArtistNotFoundError):
        await BandsintownClient("app-id").get_artist_events("ニュー・ファウンド・グローリー")


async def test_get_artist_events_scopes_invalid_parameter_to_client_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_bandsintown_api(monkeypatch, 429, None, text="rate limited: invalid parameter usage")

    with pytest.raises(BandsintownApiError):
        await BandsintownClient("app-id").get_artist_events("Metallica")


async def test_get_artist_events_raises_on_unparseable_error_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_bandsintown_api(monkeypatch, 500, None, text="<html>Server Error</html>")

    with pytest.raises(BandsintownApiError):
        await BandsintownClient("app-id").get_artist_events("Metallica")
