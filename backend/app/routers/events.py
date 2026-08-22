import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from app.core.auth import CurrentUserDep
from app.core.deps import SessionDep
from app.core.models import Artist, City, Event, EventArtist
from app.core.schemas import ArtistRead, EventRead, UserEventRead
from app.sync.matching import EVENT_MATCH_RADIUS_KM, artist_qualifies, distance_km, ticket_url

router = APIRouter()


@router.get("/me/events", response_model=list[UserEventRead])
async def list_user_events(
    user: CurrentUserDep,
    session: SessionDep,
    radius_km: Annotated[float, Query(gt=0, le=500)] = EVENT_MATCH_RADIUS_KM,
    geonameid: int | None = None,
    include_known_artists: bool | None = None,
) -> list[UserEventRead]:
    """List upcoming events by the user's servable artists near the given
    city (defaulting to the user's own). include_known_artists overrides the
    user's setting, letting the UI show everything."""
    if geonameid is not None:
        city = await session.get(City, geonameid)
        if city is None:
            raise HTTPException(status_code=404, detail="City not found")
    else:
        city = await session.get(City, user.city_id) if user.city_id is not None else None
        if city is None:
            raise HTTPException(status_code=409, detail="Set a city to match events")

    if include_known_artists is None:
        include_known_artists = user.include_known_artists
    distance = distance_km(city.latitude, city.longitude).label("distance_km")
    result = await session.execute(
        select(Event, Artist, ticket_url(Event.id), distance)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .join(Artist, Artist.id == EventArtist.artist_id)
        .where(
            artist_qualifies(user.id, EventArtist.artist_id, include_known_artists),
            Event.starts_at > func.now(),
            distance <= radius_km,
        )
        .order_by(Event.starts_at, Event.id)
    )
    grouped: dict[uuid.UUID, UserEventRead] = {}
    for event, artist, url, km in result.all():
        entry = grouped.get(event.id)
        if entry is None:
            entry = UserEventRead(
                event=EventRead.model_validate(event),
                url=url,
                distance_km=round(km, 1),
                artists=[],
            )
            grouped[event.id] = entry
        entry.artists.append(ArtistRead.model_validate(artist))
    return list(grouped.values())
