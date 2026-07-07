import uuid
from unittest.mock import AsyncMock, MagicMock

from httpx import ASGITransport, AsyncClient, Response

from app.bandsintown import BandsintownClient
from app.db import get_session
from app.lastfm import LastfmClient
from app.main import (
    app,
    get_bandsintown_client,
    get_lastfm_client,
    get_musicbrainz_client,
    get_spotify_client,
    get_temporal_client,
)
from app.musicbrainz import MusicBrainzClient
from app.spotify import SpotifyClient


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
    bandsintown: BandsintownClient | None = None,
    spotify: SpotifyClient | None = None,
    musicbrainz: MusicBrainzClient | None = None,
    temporal: object | None = None,
    json: dict | None = None,
) -> Response:
    app.dependency_overrides[get_session] = lambda: session
    if lastfm is not None:
        app.dependency_overrides[get_lastfm_client] = lambda: lastfm
    if bandsintown is not None:
        app.dependency_overrides[get_bandsintown_client] = lambda: bandsintown
    if spotify is not None:
        app.dependency_overrides[get_spotify_client] = lambda: spotify
    if musicbrainz is not None:
        app.dependency_overrides[get_musicbrainz_client] = lambda: musicbrainz
    if temporal is not None:
        app.dependency_overrides[get_temporal_client] = lambda: temporal
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, url, json=json)
    finally:
        app.dependency_overrides.clear()
