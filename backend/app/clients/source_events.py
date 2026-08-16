from datetime import datetime

from pydantic import BaseModel


class SourceEventData(BaseModel):
    """One upcoming event as reported by a concert source, normalized to the
    fields the sync stores. Datetimes are venue-local wall-clock time labeled
    UTC - the convention every consumer relies on, close enough for
    date-granular matching. A record without a start time is dated at
    midnight with time_known false. Sources that list one show once per
    ticket product report how fully configured each record is as richness;
    the richest record is the primary listing and owns the event's fields."""

    external_id: str
    title: str | None
    url: str | None
    starts_at: datetime
    time_known: bool
    richness: int
    lineup: list[str]
    venue_name: str
    venue_latitude: float
    venue_longitude: float
    street_address: str | None
    city_name: str
    region: str | None
    country: str | None


def lookup_key(name: str) -> str:
    """Case- and whitespace-insensitive comparison key for matching a source's
    artist or venue names against ours; source strings carry stray whitespace."""
    return " ".join(name.split()).casefold()
