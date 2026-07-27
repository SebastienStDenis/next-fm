import uuid
from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, aliased

from app.core.models import (
    Artist,
    BandsintownArtist,
    City,
    Event,
    EventArtist,
    UserArtistExclusion,
    UserArtistInterest,
)
from app.sync.artist_sync import LOVED_TRACKS_KIND, TOP_ARTIST_KIND

EVENT_MATCH_RADIUS_KM = 50.0

SIMILAR_ARTIST_KIND = "similar_artist"

# Known: kinds asserting the user demonstrably listens to the artist.
# Suggested: kinds written by the suggestion engine. Suggestion sync keeps the
# two effectively disjoint - it prunes a suggestion whose artist becomes known,
# though only once out of the concert-grace window, so an artist can briefly hold
# both row types. Queries classify purely by which rows exist and never
# re-derive known-ness (weight floors, grace) themselves.
KNOWN_ARTIST_KINDS = frozenset({TOP_ARTIST_KIND, LOVED_TRACKS_KIND})
SUGGESTED_ARTIST_KINDS = frozenset({SIMILAR_ARTIST_KIND})


class ArtistMatch(BaseModel):
    """A playlist-relevant artist with their soonest matched concert."""

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
    suggestion engine's concert-tied grace."""
    nearby = or_(
        *(distance_km(city.latitude, city.longitude) <= EVENT_MATCH_RADIUS_KM for city in cities)
    )
    return (Event.starts_at > func.now()) & nearby


def artist_qualifies(
    user_id: uuid.UUID,
    artist_id: InstrumentedAttribute[uuid.UUID],
    include_known_artists: bool,
) -> ColumnElement[bool]:
    """Whether an artist's concerts are servable to the user: has an interest of
    a qualifying kind and is not excluded. The known/suggested classification
    is trusted from the rows themselves, never re-derived here.

    Without known artists, an artist whose Bandsintown identity is shared by
    a known artist doesn't qualify either: it's the same act under another
    name, and the user already listens to it."""
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
        select(UserArtistExclusion.user_id)
        .where(
            UserArtistExclusion.user_id == user_id,
            UserArtistExclusion.artist_id == artist_id,
        )
        .exists()
    )
    qualifies = interest & ~excluded
    if not include_known_artists:
        qualifies = qualifies & ~_known_act_alias(user_id, artist_id)
    return qualifies


def _known_act_alias(
    user_id: uuid.UUID, artist_id: InstrumentedAttribute[uuid.UUID]
) -> ColumnElement[bool]:
    """A different artist sharing this artist's Bandsintown identity holds a
    known interest for the user. The artist's own kinds deliberately don't
    count: a suggestion that becomes known keeps its concert-tied grace."""
    own = aliased(BandsintownArtist)
    peer = aliased(BandsintownArtist)
    return (
        select(UserArtistInterest.id)
        .join(peer, peer.artist_id == UserArtistInterest.artist_id)
        .join(own, own.external_id == peer.external_id)
        .where(
            own.artist_id == artist_id,
            peer.artist_id != own.artist_id,
            UserArtistInterest.user_id == user_id,
            UserArtistInterest.kind.in_(KNOWN_ARTIST_KINDS),
        )
        .exists()
    )


async def act_representatives(
    session: AsyncSession, user_id: uuid.UUID, artist_ids: set[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """Map artists sharing a Bandsintown identity - the same act under
    different names - to one representative each: known interest first, then
    strongest weight, then name. Artists without a stored identity, or alone
    in theirs, are absent and represent themselves."""
    if not artist_ids:
        return {}
    result = await session.execute(
        select(
            BandsintownArtist.external_id,
            Artist.id,
            Artist.name,
            UserArtistInterest.kind,
            UserArtistInterest.weight,
        )
        .join(Artist, Artist.id == BandsintownArtist.artist_id)
        .join(UserArtistInterest, UserArtistInterest.artist_id == Artist.id)
        .where(
            BandsintownArtist.artist_id.in_(artist_ids),
            BandsintownArtist.external_id.is_not(None),
            UserArtistInterest.user_id == user_id,
        )
    )
    acts: dict[str, dict[uuid.UUID, tuple[bool, float, str]]] = {}
    for external_id, artist_id, name, kind, weight in result.all():
        members = acts.setdefault(external_id, {})
        known, best_weight, _ = members.get(artist_id, (False, 0.0, name))
        members[artist_id] = (
            known or kind in KNOWN_ARTIST_KINDS,
            max(best_weight, weight or 0.0),
            name,
        )

    representatives: dict[uuid.UUID, uuid.UUID] = {}
    for members in acts.values():
        if len(members) < 2:
            continue
        best = min(
            members,
            key=lambda member: (
                not members[member][0],
                -members[member][1],
                members[member][2],
            ),
        )
        for member in members:
            representatives[member] = best
    return representatives


async def match_artist_concerts(
    session: AsyncSession,
    user_id: uuid.UUID,
    city: City,
    include_known_artists: bool,
) -> list[ArtistMatch]:
    """The match join reduced to one soonest upcoming concert per servable
    artist near the city, ordered soonest-first. An act servable under
    several names counts once, through its representative."""
    result = await session.execute(
        select(EventArtist.artist_id, Event.id, Event.starts_at)
        .join(Event, Event.id == EventArtist.event_id)
        .where(
            artist_qualifies(user_id, EventArtist.artist_id, include_known_artists),
            upcoming_event_near([city]),
        )
        .order_by(Event.starts_at, Event.id)
    )
    rows = result.all()
    representatives = await act_representatives(
        session, user_id, {artist_id for artist_id, _, _ in rows}
    )
    matches: dict[uuid.UUID, ArtistMatch] = {}
    for artist_id, event_id, starts_at in rows:
        if representatives.get(artist_id, artist_id) != artist_id:
            continue
        matches.setdefault(
            artist_id, ArtistMatch(artist_id=artist_id, event_id=event_id, starts_at=starts_at)
        )
    return list(matches.values())
