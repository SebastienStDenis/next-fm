"""Sync worker entrypoint (`python -m app.worker`).

Serves the `sync_runs` queue: a few lanes poll for queued (or abandoned) runs
and execute them, and, when `NIGHTLY_SYNC_ENABLED` is true, a scheduler runs
the nightly dispatch at 06:00 UTC. The API clients are created once and
shared for the process lifetime. SIGTERM cancels everything cleanly, handing
in-flight runs back to the queue.
"""

import asyncio
import logging
import signal
from datetime import UTC, datetime, timedelta

from app.clients.lastfm import LastfmClient
from app.clients.musicbrainz import MusicBrainzClient
from app.clients.ra import RaClient
from app.clients.spotify import SpotifyClient
from app.clients.ticketmaster import TicketmasterClient
from app.core.config import get_settings
from app.core.db import session_factory
from app.core.observability import configure_observability
from app.sync.sync_pipeline import dispatch_nightly_syncs, run_sync
from app.sync.sync_runs import claim_sync_run
from app.sync.sync_steps import SyncSteps

logger = logging.getLogger(__name__)

# Manual runs get their own lanes so two users clicking Sync at once both start
# right away; two bounds how many syncs share the process's throttled clients.
MANUAL_LANES = 2
CLAIM_POLL_SECONDS = 1.0
CRASH_RETRY_SECONDS = 5.0

REQUIRED_SETTINGS = (
    "lastfm_api_key",
    "ticketmaster_api_key",
    "spotify_client_id",
    "spotify_client_secret",
    "spotify_refresh_token",
)

SCHEDULE_HOUR_UTC = 6
# A worker starting this long after the firing time still dispatches, so a
# restart around 06:00 doesn't cost a night.
SCHEDULE_CATCHUP_WINDOW = timedelta(hours=1)


def next_dispatch_at(now: datetime) -> datetime:
    """The next scheduled firing strictly after `now`."""
    today = now.replace(hour=SCHEDULE_HOUR_UTC, minute=0, second=0, microsecond=0)
    return today if today > now else today + timedelta(days=1)


def startup_dispatch_at(now: datetime) -> datetime:
    """When a freshly started worker should first dispatch: right away when
    inside the catch-up window after today's firing, else the next firing."""
    last = next_dispatch_at(now) - timedelta(days=1)
    return now if now - last < SCHEDULE_CATCHUP_WINDOW else next_dispatch_at(now)


async def _serve_runs(steps: SyncSteps) -> None:
    while True:
        try:
            async with session_factory() as session:
                run = await claim_sync_run(session)
                await session.commit()
            if run is None:
                await asyncio.sleep(CLAIM_POLL_SECONDS)
                continue
            logger.info("Claimed sync run %s for user %s", run.id, run.user_id)
            await run_sync(run, steps)
        except Exception:
            logger.exception("Sync lane failed; retrying in %ss", CRASH_RETRY_SECONDS)
            await asyncio.sleep(CRASH_RETRY_SECONDS)


async def _run_nightly_schedule(steps: SyncSteps) -> None:
    fire_at = startup_dispatch_at(datetime.now(UTC))
    while True:
        logger.info("Nightly dispatch scheduled for %s", fire_at.isoformat())
        await asyncio.sleep(max(0.0, (fire_at - datetime.now(UTC)).total_seconds()))
        try:
            await dispatch_nightly_syncs(steps)
        except Exception:
            logger.exception("Nightly dispatch failed; retrying next dispatch")
        fire_at = next_dispatch_at(datetime.now(UTC))


async def main() -> None:
    settings = get_settings()
    configure_observability(settings, "worker")
    missing = [key.upper() for key in REQUIRED_SETTINGS if not getattr(settings, key)]
    if missing:
        raise SystemExit(f"{', '.join(missing)} is not configured")

    lastfm = LastfmClient(settings.lastfm_api_key)
    ticketmaster = TicketmasterClient(settings.ticketmaster_api_key)
    ra = RaClient()
    spotify = SpotifyClient(
        settings.spotify_client_id,
        settings.spotify_client_secret,
        settings.spotify_refresh_token,
    )
    musicbrainz = MusicBrainzClient()
    steps = SyncSteps(lastfm, ticketmaster, ra, spotify, musicbrainz)

    # asyncio.run only translates SIGINT; without this a SIGTERM (Render stop,
    # `docker compose stop`, the dev hot-reload) kills the process mid-step
    # instead of handing the run back to the queue.
    main_task = asyncio.current_task()
    assert main_task is not None
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, main_task.cancel)
    try:
        async with asyncio.TaskGroup() as group:
            for _ in range(MANUAL_LANES):
                group.create_task(_serve_runs(steps))
            if settings.nightly_sync_enabled:
                group.create_task(_run_nightly_schedule(steps))
            logger.info(
                "Worker serving sync runs (%d lanes, nightly sync %s)",
                MANUAL_LANES,
                "on" if settings.nightly_sync_enabled else "off",
            )
    finally:
        for api_client in (lastfm, ticketmaster, ra, spotify, musicbrainz):
            await api_client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
