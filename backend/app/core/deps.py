import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.lastfm import LastfmClient
from app.clients.spotify import SpotifyClient
from app.clients.supabase_admin import SupabaseAdminClient
from app.core.config import get_settings
from app.core.db import get_session

logger = logging.getLogger(__name__)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_lastfm_client() -> AsyncIterator[LastfmClient]:
    api_key = get_settings().lastfm_api_key
    if not api_key:
        logger.error("LASTFM_API_KEY is not configured")
        raise HTTPException(
            status_code=503,
            detail="This service is temporarily unavailable. Please try again later.",
        )
    client = LastfmClient(api_key)
    try:
        yield client
    finally:
        await client.aclose()


LastfmClientDep = Annotated[LastfmClient, Depends(get_lastfm_client)]


SPOTIFY_SETTINGS = ("spotify_client_id", "spotify_client_secret", "spotify_refresh_token")


async def get_optional_spotify_client() -> AsyncIterator[SpotifyClient | None]:
    """None when Spotify is unconfigured - for the deleting endpoints, whose
    local deletion must go through regardless (the trigger-written tombstones
    wait for the nightly drainer)."""
    settings = get_settings()
    if any(not getattr(settings, key) for key in SPOTIFY_SETTINGS):
        yield None
        return
    client = SpotifyClient(
        settings.spotify_client_id,
        settings.spotify_client_secret,
        settings.spotify_refresh_token,
    )
    try:
        yield client
    finally:
        await client.aclose()


OptionalSpotifyClientDep = Annotated[SpotifyClient | None, Depends(get_optional_spotify_client)]


async def get_supabase_admin() -> AsyncIterator[SupabaseAdminClient | None]:
    settings = get_settings()
    if not settings.supabase_secret_key:
        yield None
        return
    client = SupabaseAdminClient(settings.supabase_url, settings.supabase_secret_key)
    try:
        yield client
    finally:
        await client.aclose()


SupabaseAdminDep = Annotated[SupabaseAdminClient | None, Depends(get_supabase_admin)]
