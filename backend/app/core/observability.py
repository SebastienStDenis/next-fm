"""Logging and error reporting, shared by the API and the worker.
Both entrypoints call this once before serving.
"""

import logging

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

from app.core.config import Settings

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s %(message)s"


def configure_observability(settings: Settings, component: str) -> None:
    """Install a root log handler and, when `SENTRY_DSN` is set, start Sentry.

    The root handler is not redundant with uvicorn, which configures only its
    own `uvicorn.*` loggers: without this, `app.*` records fall through to the
    bare-bones `logging.lastResort` handler.
    """
    logging.basicConfig(
        level=settings.log_level.upper(),
        format=LOG_FORMAT,
        force=True,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.render_git_commit or None,
        send_default_pii=False,
        traces_sample_rate=0.0,
        enable_logs=True,
        integrations=[
            LoggingIntegration(level=logging.INFO, event_level=logging.WARNING),
        ],
    )
    sentry_sdk.get_global_scope().set_tag("component", component)
