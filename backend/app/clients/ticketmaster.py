import logging
from datetime import UTC, datetime

import httpx
from aiolimiter import AsyncLimiter

from app.clients.source_events import SourceEventData, lookup_key

API_URL = "https://app.ticketmaster.com/discovery/v2"
PAGE_SIZE = 200
# Discovery paging is capped at size * page <= 1000 results.
MAX_PAGES = 5
REQUEST_INTERVAL = 0.25  # Ticketmaster allows 5 requests/second

logger = logging.getLogger(__name__)


class TicketmasterApiError(Exception):
    def __init__(self, status_code: int, message: str | None) -> None:
        super().__init__(f"Ticketmaster error {status_code}: {message}")
        self.status_code = status_code


class TicketmasterClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._http = httpx.AsyncClient(base_url=API_URL)
        self._limiter = AsyncLimiter(1, REQUEST_INTERVAL)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def find_attraction_id(self, name: str) -> str | None:
        """Id of the attraction whose name matches exactly (per lookup_key),
        or None when no candidate matches - a near-miss is more likely a
        tribute act or unrelated artist than a spelling variant."""
        payload = await self._get("/attractions.json", {"keyword": name, "size": 20})
        wanted = lookup_key(name)
        for attraction in (payload.get("_embedded") or {}).get("attractions") or []:
            if attraction.get("id") and lookup_key(attraction.get("name") or "") == wanted:
                return str(attraction["id"])
        return None

    async def get_attraction_events(self, attraction_id: str) -> list[SourceEventData]:
        """The attraction's upcoming events (Discovery serves only future
        dates), skipping cancelled ones and ones the schema can't represent."""
        events: list[SourceEventData] = []
        page = 0
        while True:
            payload = await self._get(
                "/events.json",
                {
                    "attractionId": attraction_id,
                    "size": PAGE_SIZE,
                    "page": page,
                    "sort": "date,asc",
                },
            )
            for raw in (payload.get("_embedded") or {}).get("events") or []:
                parsed = _parse_event(raw)
                if parsed is not None:
                    events.append(parsed)
            page += 1
            total_pages = (payload.get("page") or {}).get("totalPages") or 0
            if page >= min(total_pages, MAX_PAGES):
                return events

    async def _get(self, path: str, params: dict) -> dict:
        async with self._limiter:
            response = await self._http.get(path, params={**params, "apikey": self._api_key})
        if response.status_code >= 400:
            raise TicketmasterApiError(response.status_code, response.text.strip() or None)
        return response.json()


def _parse_event(event: dict) -> SourceEventData | None:
    embedded = event.get("_embedded") or {}
    dates = event.get("dates") or {}
    if ((dates.get("status") or {}).get("code") or "").casefold() == "cancelled":
        return None
    external_id = event.get("id")
    start = dates.get("start") or {}
    starts_at = _parse_start(start)
    venue = (embedded.get("venues") or [{}])[0]
    venue_name = _text_or_none(venue.get("name"))
    location = venue.get("location") or {}
    latitude = _float_or_none(location.get("latitude"))
    longitude = _float_or_none(location.get("longitude"))
    if (
        not external_id
        or starts_at is None
        or not venue_name
        or latitude is None
        or longitude is None
    ):
        missing = [
            name
            for name, present in (
                ("id", bool(external_id)),
                ("dates.start", starts_at is not None),
                ("venue.name", bool(venue_name)),
                ("venue.location", latitude is not None and longitude is not None),
            )
            if not present
        ]
        logger.warning(
            "Dropped Ticketmaster event %r (missing %s)", external_id, ", ".join(missing)
        )
        return None
    lineup = [
        attraction["name"]
        for attraction in embedded.get("attractions") or []
        if attraction.get("name")
    ]
    # The primary listing of a show is the fully configured record: it had a
    # presale window, has a seat map, and add-on products (parking, packages)
    # hang off it. Ticket-product variants of the same show - suites, passes,
    # tiers - are thin records at the same venue and time.
    richness = sum(
        bool(value)
        for value in (
            (event.get("sales") or {}).get("presales"),
            event.get("seatmap"),
            event.get("products"),
        )
    )
    return SourceEventData(
        external_id=str(external_id),
        title=_text_or_none(event.get("name")),
        url=_text_or_none(event.get("url")),
        starts_at=starts_at,
        time_known=bool(start.get("localTime")) and not start.get("noSpecificTime"),
        richness=richness,
        lineup=lineup,
        venue_name=venue_name,
        venue_latitude=latitude,
        venue_longitude=longitude,
        street_address=_text_or_none((venue.get("address") or {}).get("line1")),
        city_name=_text_or_none((venue.get("city") or {}).get("name")) or "",
        region=_text_or_none((venue.get("state") or {}).get("stateCode")),
        country=_text_or_none((venue.get("country") or {}).get("name")),
    )


def _parse_start(start: dict) -> datetime | None:
    """localDate + localTime (midnight when the time is TBA) labeled UTC,
    the venue-local wall-clock convention."""
    local_date = start.get("localDate")
    if not local_date:
        return None
    try:
        parsed = datetime.fromisoformat(f"{local_date}T{start.get('localTime') or '00:00:00'}")
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC)


def _text_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def _float_or_none(value: str | float | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None
