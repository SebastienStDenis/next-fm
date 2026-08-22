import logging

import pytest

from app.core.config import Settings
from app.core.observability import configure_observability


def test_configure_observability_suppresses_httpx_request_logs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    httpx_logger = logging.getLogger("httpx")
    monkeypatch.setattr(logging, "basicConfig", lambda **kwargs: None)
    monkeypatch.setattr(httpx_logger, "level", logging.NOTSET)

    configure_observability(Settings(sentry_dsn=""), "api")

    with caplog.at_level(logging.INFO):
        logging.getLogger("app.test").info("Application detail")
        httpx_logger.info("HTTP Request: GET https://example.invalid/path?api_key")

    assert caplog.messages == ["Application detail"]
    assert httpx_logger.level == logging.WARNING
