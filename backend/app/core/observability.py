"""Logging and error reporting, shared by the API and the worker.

Both entrypoints call `configure()` before serving. It installs a root log
handler and, when `SENTRY_DSN` is set, starts Sentry.

The root handler is not redundant with uvicorn: uvicorn configures only its own
`uvicorn.*` loggers and leaves the root logger bare, so without this every
`app.*` record falls through to `logging.lastResort` - warnings to stderr with
no timestamp, level, or logger name, and info dropped entirely.

Sentry reports at WARNING rather than its ERROR default because WARNING is the
level this codebase logs its real failures at: a broken upstream, a failed sync
step, a missing API key. At the default almost nothing would be reported.

Log records are also forwarded to Sentry Logs, which is a copy of what Render
already keeps rather than a replacement for it: Render captures stdout
regardless. It earns the duplication by searching the api and worker streams
together - they are separate services on Render - and by hanging the run-up to
a failure off the error itself.
"""

import logging

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

from app.core.config import Settings

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s %(message)s"


def configure_observability(settings: Settings, component: str) -> None:
    logging.basicConfig(
        level=settings.log_level.upper(),
        format=LOG_FORMAT,
        force=True,
    )
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.render_git_commit or None,
        send_default_pii=False,
        # Tracing would spend the quota on request volume that says nothing
        # about failures; logs and errors are the whole point here.
        traces_sample_rate=0.0,
        enable_logs=True,
        integrations=[
            # `sentry_logs_level` stays at its INFO default: everything the root
            # handler above emits is forwarded to Sentry Logs, and the WARNING
            # subset that carries an exception also opens an issue.
            LoggingIntegration(level=logging.INFO, event_level=logging.WARNING),
        ],
    )
    # The api and worker services share one DSN; this is what tells them apart.
    sentry_sdk.get_global_scope().set_tag("component", component)
