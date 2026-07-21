from unittest.mock import AsyncMock

from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.main import app


def fake_session() -> AsyncMock:
    return AsyncMock()


async def test_health() -> None:
    app.dependency_overrides[get_session] = fake_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/health")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
