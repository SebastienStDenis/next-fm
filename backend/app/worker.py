"""Temporal worker entrypoint (`python -m app.worker`).

Runs the sync pipeline's workflows and activities, and reconciles the
`nightly-sync` temporal schedule on startup - created when `NIGHTLY_SYNC_ENABLED`
is true, deleted otherwise.
"""

import asyncio
import logging
from datetime import timedelta

from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest
from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleAlreadyRunningError,
    ScheduleCalendarSpec,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleRange,
    ScheduleSpec,
)
from temporalio.service import RPCError, RPCStatusCode
from temporalio.worker import Worker

from app.clients.lastfm import LastfmClient
from app.clients.musicbrainz import MusicBrainzClient
from app.clients.ra import RaClient
from app.clients.spotify import SpotifyClient
from app.clients.ticketmaster import TicketmasterClient
from app.core.config import Settings, get_settings
from app.core.observability import configure_observability
from app.core.temporal import connect_temporal
from app.sync.sync_activities import SyncActivities
from app.sync.sync_workflow import DispatchSyncsWorkflow, SyncUserWorkflow

logger = logging.getLogger(__name__)

CONNECT_ATTEMPTS = 90
CONNECT_RETRY_SECONDS = 2.0
CRASH_RETRY_SECONDS = 5.0

REQUIRED_SETTINGS = (
    "lastfm_api_key",
    "ticketmaster_api_key",
    "spotify_client_id",
    "spotify_client_secret",
    "spotify_refresh_token",
)

SCHEDULE_ID = "nightly-sync"
SCHEDULE_HOUR_UTC = 6
SCHEDULE_CATCHUP_WINDOW = timedelta(hours=1)


async def _reconcile_nightly_schedule(client: Client, settings: Settings) -> None:
    if not settings.nightly_sync_enabled:
        # Delete the schedule from temporal, don't just skip creation.
        try:
            await client.get_schedule_handle(SCHEDULE_ID).delete()
            logger.warning("Deleted schedule %r (nightly sync disabled)", SCHEDULE_ID)
        except RPCError as exc:
            if exc.status != RPCStatusCode.NOT_FOUND:
                # Log and try again next time
                logger.exception("Failed to delete schedule %r", SCHEDULE_ID)
        return
    # Create-if-missing: editing the spec below does not update an existing
    # schedule; delete it manually (or `temporal schedule update`) and let
    # the worker recreate it.
    schedule = Schedule(
        action=ScheduleActionStartWorkflow(
            DispatchSyncsWorkflow.run,
            id="dispatch-syncs",
            task_queue=settings.temporal_task_queue,
        ),
        spec=ScheduleSpec(
            calendars=[ScheduleCalendarSpec(hour=(ScheduleRange(SCHEDULE_HOUR_UTC),))]
        ),
        policy=SchedulePolicy(
            overlap=ScheduleOverlapPolicy.SKIP,
            catchup_window=SCHEDULE_CATCHUP_WINDOW,
        ),
    )
    try:
        await client.create_schedule(SCHEDULE_ID, schedule)
        logger.info("Created schedule %r", SCHEDULE_ID)
    except ScheduleAlreadyRunningError:
        logger.info("Schedule %r already exists", SCHEDULE_ID)


async def _connect_with_retry(settings: Settings) -> Client:
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            client = await connect_temporal(settings)
            # No-op call to our namespace - fails if temporal is up but our namespace is not ready
            await client.workflow_service.describe_namespace(
                DescribeNamespaceRequest(namespace=settings.temporal_namespace)
            )
            return client
        except (RPCError, OSError, RuntimeError) as exc:
            if attempt == CONNECT_ATTEMPTS:
                raise
            logger.info(
                "Temporal not reachable at %s (attempt %d/%d): %s",
                settings.temporal_address,
                attempt,
                CONNECT_ATTEMPTS,
                exc,
            )
            await asyncio.sleep(CONNECT_RETRY_SECONDS)
    raise AssertionError("unreachable")


async def _run_worker(settings: Settings, activities: SyncActivities) -> None:
    client = await _connect_with_retry(settings)
    await _reconcile_nightly_schedule(client, settings)
    worker = Worker(
        client,
        task_queue=settings.temporal_task_queue,
        workflows=[SyncUserWorkflow, DispatchSyncsWorkflow],
        activities=[
            activities.sync_artists,
            activities.sync_suggestions,
            activities.sync_events,
            activities.sync_playlists,
            activities.record_sync_completed,
            activities.list_users_due_for_sync,
            activities.audit_bot_playlists,
            activities.drain_playlist_tombstones,
        ],
    )
    logger.info("Worker polling task queue %r", settings.temporal_task_queue)
    await worker.run()


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
    try:
        activities = SyncActivities(lastfm, ticketmaster, ra, spotify, musicbrainz)
        # Nothing external supervises this process, so a crashed poller must reconnect
        # and resume on its own instead of leaving an "Up" container doing nothing.
        while True:
            try:
                await _run_worker(settings, activities)
            except Exception:
                logger.exception("Worker crashed; restarting in %ss", CRASH_RETRY_SECONDS)
                await asyncio.sleep(CRASH_RETRY_SECONDS)
    finally:
        for api_client in (lastfm, ticketmaster, ra, spotify, musicbrainz):
            await api_client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
