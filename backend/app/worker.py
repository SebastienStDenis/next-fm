"""Temporal worker entrypoint (`python -m app.worker`).

Runs the sync pipeline's workflows and activities, and reconciles the
`nightly-sync` schedule on startup - created when `NIGHTLY_SYNC_ENABLED` is
true, deleted otherwise - so no environment needs dashboard setup
(docs/design/2026-07-09-background-sync-plan.md). Builds from
the same image and settings as the API; the worker owns one long-lived
instance of each API client, shared across activities for the life of the
process.
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

from app.bandsintown import BandsintownClient
from app.config import Settings, get_settings
from app.lastfm import LastfmClient
from app.musicbrainz import MusicBrainzClient
from app.spotify import SpotifyClient
from app.sync_activities import SyncActivities
from app.sync_workflow import DispatchSyncsWorkflow, SyncUserWorkflow
from app.temporal import connect_temporal

logger = logging.getLogger(__name__)

CONNECT_ATTEMPTS = 90
CONNECT_RETRY_SECONDS = 2.0
CRASH_RETRY_SECONDS = 5.0

REQUIRED_SETTINGS = (
    "lastfm_api_key",
    "bandsintown_api_key",
    "spotify_client_id",
    "spotify_client_secret",
    "spotify_refresh_token",
)

SCHEDULE_ID = "nightly-sync"
# Overnight for the initial (Eastern) audience and off-peak for the third-party
# APIs; playlists are fresh by morning.
SCHEDULE_HOUR_UTC = 6
# A missed night is a skipped refresh, not a debt to repay: without this, a
# locally stopped stack would fire every missed dispatch on the next start.
SCHEDULE_CATCHUP_WINDOW = timedelta(hours=1)


async def _reconcile_nightly_schedule(client: Client, settings: Settings) -> None:
    if not settings.nightly_sync_enabled:
        # Deleting (not just skipping creation) is what makes turning the flag
        # off effective: the schedule persists in Temporal's database from
        # earlier starts.
        try:
            await client.get_schedule_handle(SCHEDULE_ID).delete()
            logger.warning("Deleted schedule %r (nightly sync disabled)", SCHEDULE_ID)
        except RPCError as exc:
            if exc.status != RPCStatusCode.NOT_FOUND:
                # A leftover schedule is not worth taking down task-queue
                # polling; the next worker start retries the delete.
                logger.exception("Failed to delete schedule %r", SCHEDULE_ID)
        return
    # Create-if-missing: editing the spec below does not update an existing
    # schedule; delete it (or `temporal schedule update`) and let the worker
    # recreate it.
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
    # The compose worker starts alongside the Temporal server, which takes a
    # while to come up; retry instead of ordering startup precisely. Checking
    # the namespace matters as much as connecting: on a fresh database,
    # auto-setup registers it well after the server starts answering gRPC.
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            client = await connect_temporal(settings)
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
        ],
    )
    logger.info("Worker polling task queue %r", settings.temporal_task_queue)
    await worker.run()


async def main() -> None:
    settings = get_settings()
    missing = [key.upper() for key in REQUIRED_SETTINGS if not getattr(settings, key)]
    if missing:
        raise SystemExit(f"{', '.join(missing)} is not configured")

    lastfm = LastfmClient(settings.lastfm_api_key)
    bandsintown = BandsintownClient(settings.bandsintown_api_key)
    spotify = SpotifyClient(
        settings.spotify_client_id,
        settings.spotify_client_secret,
        settings.spotify_refresh_token,
    )
    musicbrainz = MusicBrainzClient()
    try:
        activities = SyncActivities(lastfm, bandsintown, spotify, musicbrainz)
        # Nothing external supervises this process (watchfiles restarts it on
        # file changes, not on crashes), so a crashed poller must reconnect and
        # resume on its own instead of leaving an "Up" container doing nothing.
        while True:
            try:
                await _run_worker(settings, activities)
            except Exception:
                logger.exception("Worker crashed; restarting in %ss", CRASH_RETRY_SECONDS)
                await asyncio.sleep(CRASH_RETRY_SECONDS)
    finally:
        for api_client in (lastfm, bandsintown, spotify, musicbrainz):
            await api_client.aclose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
