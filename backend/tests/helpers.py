import uuid
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient, Response

from app.db import get_session
from app.lastfm import LastfmClient
from app.main import app, get_lastfm_client


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
    result.scalar_one_or_none.return_value = value
    return result


async def request(
    method: str,
    url: str,
    session: AsyncMock,
    lastfm: LastfmClient | None = None,
    json: dict | None = None,
) -> Response:
    app.dependency_overrides[get_session] = lambda: session
    if lastfm is not None:
        app.dependency_overrides[get_lastfm_client] = lambda: lastfm
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, url, json=json)
    finally:
        app.dependency_overrides.clear()
