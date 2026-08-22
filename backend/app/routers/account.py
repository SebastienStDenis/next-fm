import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BeforeValidator
from sqlalchemy import func, or_, select

from app.core.auth import CurrentUserDep, get_claims
from app.core.deps import OptionalSpotifyClientDep, SessionDep, SupabaseAdminDep
from app.core.models import City, Playlist, User
from app.core.schemas import CityRead, CitySet, UserRead, UserUpdate
from app.sync.playlist_sync import settle_tombstone

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUserDep) -> User:
    """Return the authenticated user, provisioning the row on first login."""
    return user


@router.patch("/me", response_model=UserRead)
async def update_me(user: CurrentUserDep, payload: UserUpdate, session: SessionDep) -> User:
    """Update the user's settings."""
    if payload.include_known_artists is not None:
        user.include_known_artists = payload.include_known_artists
    if payload.name is not None:
        user.name = payload.name
    await session.commit()
    return user


@router.delete("/me", status_code=204)
async def delete_me(
    user: CurrentUserDep,
    session: SessionDep,
    admin: SupabaseAdminDep,
    spotify: OptionalSpotifyClientDep,
) -> None:
    """Delete the account: the Supabase auth user first, then the app row and
    everything cascading (including deleted playlist tombstone)."""
    if user.supabase_user_id is not None:
        if admin is None:
            logger.error("SUPABASE_SECRET_KEY is not configured")
            raise HTTPException(
                status_code=503,
                detail="This service is temporarily unavailable. Please try again later.",
            )
        await admin.delete_user(user.supabase_user_id)
    result = await session.execute(
        select(Playlist.spotify_playlist_id).where(
            Playlist.user_id == user.id, Playlist.spotify_playlist_id.is_not(None)
        )
    )
    remote_ids = [remote_id for remote_id in result.scalars() if remote_id is not None]
    await session.delete(user)
    await session.commit()
    # Best-effort playlist cleanup; nightly drainer is the backup so don't throw on failure.
    if spotify is not None:
        try:
            settled = False
            for remote_id in remote_ids:
                settled = await settle_tombstone(session, spotify, remote_id) or settled
            if settled:
                await session.commit()
        except Exception:
            logger.exception("Post-delete playlist cleanup failed; tombstones remain")


CITY_FUZZY_THRESHOLD = 0.45


@router.get(
    "/cities",
    response_model=list[CityRead],
    dependencies=[Depends(get_claims)],
)
async def search_cities(
    q: Annotated[str, BeforeValidator(str.strip), Query(min_length=2)],
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> list[City]:
    """Search cities by name: substring and fuzzy matches, best first."""
    similarity = func.greatest(
        func.word_similarity(q, City.name),
        func.word_similarity(q, City.ascii_name),
    )
    await session.execute(
        select(
            func.set_config("pg_trgm.word_similarity_threshold", str(CITY_FUZZY_THRESHOLD), True)
        )
    )
    result = await session.execute(
        select(City)
        .where(
            or_(
                City.name.icontains(q, autoescape=True),
                City.ascii_name.icontains(q, autoescape=True),
                City.name.bool_op("%>")(q),
                City.ascii_name.bool_op("%>")(q),
            )
        )
        .order_by(
            City.ascii_name.istartswith(q, autoescape=True).desc(),
            # bucket similarity so population breaks near-ties instead of
            # a marginally closer trigram match beating a major city
            func.floor(similarity * 10).desc(),
            City.population.desc(),
            City.geonameid,
        )
        .limit(limit)
    )
    return list(result.scalars())


@router.get("/me/city", response_model=CityRead)
async def get_user_city(user: CurrentUserDep, session: SessionDep) -> City:
    """Return the user's city; 404 if none is set."""
    city = await session.get(City, user.city_id) if user.city_id is not None else None
    if city is None:
        raise HTTPException(status_code=404, detail="No city set")
    return city


@router.put("/me/city", response_model=CityRead)
async def set_user_city(user: CurrentUserDep, payload: CitySet, session: SessionDep) -> City:
    """Set the user's city, replacing any existing one."""
    city = await session.get(City, payload.geonameid)
    if city is None:
        raise HTTPException(status_code=404, detail="City not found")
    user.city_id = city.geonameid
    await session.commit()
    return city


@router.delete("/me/city", status_code=204)
async def clear_user_city(user: CurrentUserDep, session: SessionDep) -> None:
    """Remove the user's city; 404 if none is set."""
    if user.city_id is None:
        raise HTTPException(status_code=404, detail="No city set")
    user.city_id = None
    await session.commit()
