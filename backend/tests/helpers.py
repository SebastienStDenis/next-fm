import uuid
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient, Response

from app.clients.lastfm import LastfmClient
from app.clients.spotify import SpotifyClient
from app.core.auth import Claims, get_claims, get_current_user
from app.core.db import get_session
from app.core.deps import get_lastfm_client, get_optional_spotify_client, get_supabase_admin
from app.core.models import User
from app.main import app


def make_session() -> AsyncMock:
    session = AsyncMock()
    session.add = MagicMock()

    async def flush() -> None:
        for call in session.add.call_args_list:
            obj = call.args[0]
            if obj.id is None:
                obj.id = uuid.uuid7()

    session.flush = flush
    return session


def result_returning(value: object) -> MagicMock:
    result = MagicMock()
    result.scalar_one.return_value = value
    result.scalar_one_or_none.return_value = value
    return result


def result_with_scalars(rows: list) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value = rows
    return result


def result_with_rows(rows: list) -> MagicMock:
    result = MagicMock()
    result.all.return_value = rows
    return result


def added_objects(session: AsyncMock, kind: type) -> list:
    return [call.args[0] for call in session.add.call_args_list if isinstance(call.args[0], kind)]


async def request(
    method: str,
    url: str,
    session: AsyncMock,
    lastfm: LastfmClient | None = None,
    spotify: SpotifyClient | None = None,
    user: User | None = None,
    claims: Claims | None = None,
    supabase_admin: object | None = None,
    json: dict | None = None,
) -> Response:
    app.dependency_overrides[get_session] = lambda: session
    # Always overridden (to None when absent) so no test constructs a real
    # client from whatever the local .env holds.
    app.dependency_overrides[get_optional_spotify_client] = lambda: spotify
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    if claims is not None:
        app.dependency_overrides[get_claims] = lambda: claims
    if supabase_admin is not None:
        app.dependency_overrides[get_supabase_admin] = lambda: supabase_admin
    if lastfm is not None:
        app.dependency_overrides[get_lastfm_client] = lambda: lastfm
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, url, json=json)
    finally:
        app.dependency_overrides.clear()
