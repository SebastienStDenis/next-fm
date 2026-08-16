import logging
from datetime import UTC, datetime

import httpx
from aiolimiter import AsyncLimiter

from app.clients.source_events import SourceEventData, lookup_key

API_URL = "https://ra.co/graphql"
SITE_URL = "https://ra.co"
# Unofficial API (the endpoint behind RA's own web app; there is no public
# one) - keep traffic unmistakably polite and expect breakage; see
# docs/design/2026-08-09-multi-source-event-ingestion.md.
REQUEST_INTERVAL = 1.0
# Cloudflare rejects non-browser agents.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
EVENTS_LIMIT = 100

logger = logging.getLogger(__name__)

SEARCH_QUERY = """
query SearchArtists($searchTerm: String!) {
  search(searchTerm: $searchTerm, indices: [ARTIST], limit: 10) {
    id
    value
  }
}
"""

# LATEST is the type RA's own artist pages use for the upcoming-events list;
# it returns exactly the artist's future events, worldwide.
ARTIST_EVENTS_QUERY = """
query ArtistUpcomingEvents($artistId: ID!, $limit: Int!) {
  artist(id: $artistId) {
    events(limit: $limit, type: LATEST) {
      id
      title
      startTime
      contentUrl
      artists { name }
      venue {
        name
        address
        location { latitude longitude }
        area { name country { name } }
      }
    }
  }
}
"""


class RaApiError(Exception):
    def __init__(self, status_code: int, message: str | None) -> None:
        super().__init__(f"RA error {status_code}: {message}")
        self.status_code = status_code


class RaClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(headers={"User-Agent": USER_AGENT, "Referer": SITE_URL})
        self._limiter = AsyncLimiter(1, REQUEST_INTERVAL)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def find_artist_id(self, name: str) -> str | None:
        """Id of the RA artist whose name matches exactly (per lookup_key),
        or None when no candidate matches."""
        data = await self._query("SearchArtists", SEARCH_QUERY, {"searchTerm": name})
        wanted = lookup_key(name)
        for hit in data.get("search") or []:
            if hit.get("id") and lookup_key(hit.get("value") or "") == wanted:
                return str(hit["id"])
        return None

    async def get_artist_events(self, artist_id: str) -> list[SourceEventData]:
        """The artist's upcoming events, skipping ones the schema can't
        represent (TBA venues carry (0, 0) coordinates and are dropped)."""
        data = await self._query(
            "ArtistUpcomingEvents",
            ARTIST_EVENTS_QUERY,
            {"artistId": artist_id, "limit": EVENTS_LIMIT},
        )
        artist = data.get("artist") or {}
        events = (_parse_event(event) for event in artist.get("events") or [])
        return [event for event in events if event is not None]

    async def _query(self, operation: str, query: str, variables: dict) -> dict:
        async with self._limiter:
            response = await self._http.post(
                API_URL,
                json={"operationName": operation, "query": query, "variables": variables},
            )
        if response.status_code >= 400:
            raise RaApiError(response.status_code, response.text.strip()[:200] or None)
        payload = response.json()
        if payload.get("errors"):
            message = (payload["errors"][0] or {}).get("message")
            raise RaApiError(response.status_code, message)
        return payload.get("data") or {}


def _parse_event(event: dict) -> SourceEventData | None:
    external_id = event.get("id")
    starts_at = _parse_datetime(event.get("startTime"))
    venue = event.get("venue") or {}
    venue_name = _text_or_none(venue.get("name"))
    location = venue.get("location") or {}
    latitude, longitude = location.get("latitude"), location.get("longitude")
    if latitude == 0 and longitude == 0:
        latitude = longitude = None
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
                ("startTime", starts_at is not None),
                ("venue.name", bool(venue_name)),
                ("venue.location", latitude is not None and longitude is not None),
            )
            if not present
        ]
        logger.info("Dropped RA event %r (missing %s)", external_id, ", ".join(missing))
        return None
    area = venue.get("area") or {}
    content_url = event.get("contentUrl")
    return SourceEventData(
        external_id=str(external_id),
        title=_text_or_none(event.get("title")),
        url=SITE_URL + content_url if content_url else None,
        lineup=[artist["name"] for artist in event.get("artists") or [] if artist.get("name")],
        starts_at=starts_at,
        time_known=True,
        richness=0,
        venue_name=venue_name,
        venue_latitude=float(latitude),
        venue_longitude=float(longitude),
        street_address=_text_or_none(venue.get("address")),
        city_name=_text_or_none(area.get("name")) or "",
        region=None,
        country=_text_or_none((area.get("country") or {}).get("name")),
    )


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    # RA datetimes are venue-local wall-clock time; labeling that as UTC is
    # the convention every consumer relies on.
    return parsed.replace(tzinfo=UTC)


def _text_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None
