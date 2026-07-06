import uuid
from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.artist_sync import LOVED_TRACKS_KIND, TOP_ARTIST_KIND
from app.models import City, Event, EventArtist, UserArtistExclusion, UserArtistInterest

EVENT_MATCH_RADIUS_KM = 50.0

SIMILAR_ARTIST_KIND = "similar_artist"

# Known: kinds asserting the user demonstrably listens to the artist.
# Suggested: kinds written by the suggestion engine. Suggestion sync keeps the
# two effectively disjoint - it prunes a suggestion whose artist becomes known,
# though only once out of the show-grace window, so an artist can briefly hold
# both row types. Queries classify purely by which rows exist and never
# re-derive known-ness (weight floors, grace) themselves.
KNOWN_ARTIST_KINDS = frozenset({TOP_ARTIST_KIND, LOVED_TRACKS_KIND})
SUGGESTED_ARTIST_KINDS = frozenset({SIMILAR_ARTIST_KIND})


class ArtistMatch(BaseModel):
    """A playlist-relevant artist with their soonest matched show."""

    artist_id: uuid.UUID
    event_id: uuid.UUID
    starts_at: datetime


def distance_km(latitude: float, longitude: float) -> ColumnElement[float]:
    """Haversine distance in km from the given point to Event's venue."""
    lat1, lon1 = func.radians(latitude), func.radians(longitude)
    lat2, lon2 = func.radians(Event.venue_latitude), func.radians(Event.venue_longitude)
    central_angle = 2 * func.asin(
        func.sqrt(
            func.power(func.sin((lat2 - lat1) / 2), 2)
            + func.cos(lat1) * func.cos(lat2) * func.power(func.sin((lon2 - lon1) / 2), 2)
        )
    )
    return 6371.0 * central_angle


def upcoming_event_near(cities: Sequence[City]) -> ColumnElement[bool]:
    """Event is upcoming and within EVENT_MATCH_RADIUS_KM of any of the given
    cities - the servable predicate shared by the match join and the
    suggestion engine's show-tied grace."""
    nearby = or_(
        *(distance_km(city.latitude, city.longitude) <= EVENT_MATCH_RADIUS_KM for city in cities)
    )
    return (Event.starts_at > func.now()) & nearby


def artist_qualifies(
    user_id: uuid.UUID,
    artist_id: InstrumentedAttribute[uuid.UUID],
    include_known_artists: bool,
) -> ColumnElement[bool]:
    """Whether an artist's shows are servable to the user: has an interest of
    a qualifying kind and is not excluded. The known/suggested classification
    is trusted from the rows themselves, never re-derived here."""
    kinds = SUGGESTED_ARTIST_KINDS
    if include_known_artists:
        kinds = kinds | KNOWN_ARTIST_KINDS
    interest = (
        select(UserArtistInterest.id)
        .where(
            UserArtistInterest.user_id == user_id,
            UserArtistInterest.artist_id == artist_id,
            UserArtistInterest.kind.in_(kinds),
        )
        .exists()
    )
    excluded = (
        select(UserArtistExclusion.id)
        .where(
            UserArtistExclusion.user_id == user_id,
            UserArtistExclusion.artist_id == artist_id,
        )
        .exists()
    )
    return interest & ~excluded


async def match_artist_shows(
    session: AsyncSession,
    user_id: uuid.UUID,
    city: City,
    include_known_artists: bool,
) -> list[ArtistMatch]:
    """The match join reduced to one soonest upcoming show per servable
    artist near the city, ordered soonest-first."""
    result = await session.execute(
        select(EventArtist.artist_id, Event.id, Event.starts_at)
        .join(Event, Event.id == EventArtist.event_id)
        .where(
            artist_qualifies(user_id, EventArtist.artist_id, include_known_artists),
            upcoming_event_near([city]),
        )
        .order_by(Event.starts_at, Event.id)
    )
    matches: dict[uuid.UUID, ArtistMatch] = {}
    for artist_id, event_id, starts_at in result.all():
        matches.setdefault(
            artist_id, ArtistMatch(artist_id=artist_id, event_id=event_id, starts_at=starts_at)
        )
    return list(matches.values())
