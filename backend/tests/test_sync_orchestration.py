import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from temporalio import activity
from temporalio.client import WorkflowExecutionStatus, WorkflowFailureError
from temporalio.common import WorkflowIDConflictPolicy
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.exceptions import ApplicationError
from temporalio.service import RPCError, RPCStatusCode
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from app.lastfm import LastfmPrivateDataError
from app.models import LastfmAccount, User
from app.schemas import (
    ArtistSyncKindResult,
    ArtistSyncResult,
    DispatchSyncsResult,
    EventSyncResult,
    PlaylistSyncResult,
    SuggestionSyncResult,
    SyncRunResult,
    SyncStepProgress,
    TombstoneDrainResult,
)
from app.spotify import SpotifyAuthError
from app.sync_activities import (
    STEP_FAILED_SUGGESTIONS,
    SyncActivities,
    _user_facing_errors,
)
from app.sync_workflow import (
    DispatchSyncsWorkflow,
    SyncUserWorkflow,
    pending_steps,
    user_sync_workflow_id,
)
from tests.helpers import make_session, request, result_returning, result_with_scalars

USER_ID = uuid.uuid7()
SYNC_URL = "/me/sync"
WORKFLOW_ID = f"user-sync-{USER_ID}"

SYNCED_AT = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)

ARTIST_RESULT = ArtistSyncResult(
    synced_at=SYNCED_AT,
    results=[
        ArtistSyncKindResult(
            kind="lastfm_top_artist",
            artists=3,
            interests_created=2,
            interests_updated=1,
            interests_removed=0,
        ),
        ArtistSyncKindResult(
            kind="lastfm_loved_tracks",
            artists=1,
            interests_created=1,
            interests_updated=0,
            interests_removed=0,
        ),
    ],
)

SUGGESTION_RESULT = SuggestionSyncResult(
    synced_at=SYNCED_AT,
    seeds_total=5,
    seeds_synced=3,
    seeds_skipped=2,
    seeds_failed=0,
    candidates_scored=40,
    suggestions_created=10,
    suggestions_kept=5,
    suggestions_removed=1,
    artists_enriched=12,
    artists_enrich_failed=0,
)

EVENT_RESULT = EventSyncResult(
    synced_at=SYNCED_AT,
    artists_total=14,
    artists_synced=10,
    artists_skipped=3,
    artists_unknown=1,
    artists_failed=0,
    events_created=4,
    events_updated=2,
    events_removed=1,
)

PLAYLIST_RESULT = PlaylistSyncResult(
    synced_at=SYNCED_AT,
    artists_matched=6,
    artists_resolved=5,
    artists_unresolved=1,
    top_tracks_refreshed=5,
    playlists=[],
)


def make_user() -> User:
    return User(id=USER_ID, name="Ada", include_known_artists=True, city_id=6077243)


def make_account() -> LastfmAccount:
    return LastfmAccount(id=uuid.uuid7(), username="rj")


def make_temporal(handle: MagicMock | None = None) -> MagicMock:
    client = MagicMock()
    client.start_workflow = AsyncMock(return_value=SimpleNamespace(id=WORKFLOW_ID))
    client.get_workflow_handle = MagicMock(return_value=handle)
    return client


def make_handle(
    status: WorkflowExecutionStatus | None,
    steps: list[SyncStepProgress] | None = None,
    started_at: datetime | None = SYNCED_AT,
    finished_at: datetime | None = None,
) -> MagicMock:
    handle = MagicMock()
    handle.describe = AsyncMock(
        return_value=SimpleNamespace(status=status, start_time=started_at, close_time=finished_at)
    )
    handle.query = AsyncMock(return_value=steps if steps is not None else pending_steps())
    handle.result = AsyncMock(
        return_value=SyncRunResult(steps=steps if steps is not None else pending_steps())
    )
    return handle


# --- POST /me/sync ---


async def test_start_sync_requires_authentication() -> None:
    session = make_session()
    temporal = make_temporal()

    response = await request("POST", SYNC_URL, session, temporal=temporal)

    assert response.status_code == 401
    temporal.start_workflow.assert_not_awaited()


async def test_start_sync_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)
    temporal = make_temporal()

    response = await request("POST", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"
    temporal.start_workflow.assert_not_awaited()


async def test_start_sync_when_no_home_city() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    temporal = make_temporal()
    user = User(id=USER_ID, name="Ada", include_known_artists=True)

    response = await request("POST", SYNC_URL, session, temporal=temporal, user=user)

    assert response.status_code == 404
    assert response.json()["detail"] == "No home city set"
    temporal.start_workflow.assert_not_awaited()


async def test_start_sync_starts_workflow() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    temporal = make_temporal()

    response = await request("POST", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 202
    assert response.json() == {"workflow_id": WORKFLOW_ID, "status": "running"}
    temporal.start_workflow.assert_awaited_once()
    kwargs = temporal.start_workflow.await_args.kwargs
    assert kwargs["id"] == WORKFLOW_ID
    assert kwargs["id_conflict_policy"] == WorkflowIDConflictPolicy.USE_EXISTING


async def test_start_sync_maps_temporal_errors_to_502() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    temporal = make_temporal()
    temporal.start_workflow = AsyncMock(
        side_effect=RPCError("unavailable", RPCStatusCode.UNAVAILABLE, b"")
    )

    response = await request("POST", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 502


# --- GET /me/sync ---


async def test_sync_status_without_any_run() -> None:
    session = make_session()
    handle = MagicMock()
    handle.describe = AsyncMock(side_effect=RPCError("not found", RPCStatusCode.NOT_FOUND, b""))
    temporal = make_temporal(handle)

    response = await request("GET", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "none"
    assert body["started_at"] is None
    assert [step["key"] for step in body["steps"]] == [
        "artists",
        "suggestions",
        "events",
        "playlists",
    ]
    assert all(step["status"] == "pending" for step in body["steps"])


async def test_sync_status_running_reports_step_progress() -> None:
    session = make_session()
    steps = pending_steps()
    steps[0].status = "completed"
    steps[0].summary = "Imported 4 artists · 3 added, 1 updated, 0 removed"
    steps[1].status = "running"
    handle = make_handle(WorkflowExecutionStatus.RUNNING, steps)
    temporal = make_temporal(handle)

    response = await request("GET", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "running"
    assert body["started_at"] is not None
    assert body["steps"][0]["status"] == "completed"
    assert body["steps"][0]["summary"] == steps[0].summary
    assert body["steps"][1]["status"] == "running"
    assert body["steps"][2]["status"] == "pending"


async def test_sync_status_maps_terminal_statuses() -> None:
    session = make_session()
    for execution_status, expected in [
        (WorkflowExecutionStatus.COMPLETED, "completed"),
        (WorkflowExecutionStatus.FAILED, "failed"),
        (WorkflowExecutionStatus.TERMINATED, "failed"),
        (WorkflowExecutionStatus.TIMED_OUT, "failed"),
    ]:
        handle = make_handle(execution_status, finished_at=SYNCED_AT)
        temporal = make_temporal(handle)

        response = await request("GET", SYNC_URL, session, temporal=temporal, user=make_user())

        assert response.status_code == 200
        assert response.json()["status"] == expected
        assert response.json()["finished_at"] is not None


async def test_sync_status_completed_reads_steps_from_result() -> None:
    session = make_session()
    steps = pending_steps()
    for step in steps:
        step.status = "completed"
    handle = make_handle(WorkflowExecutionStatus.COMPLETED, steps, finished_at=SYNCED_AT)
    temporal = make_temporal(handle)

    response = await request("GET", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert all(step["status"] == "completed" for step in body["steps"])
    handle.query.assert_not_awaited()


async def test_sync_status_degrades_when_query_fails() -> None:
    session = make_session()
    handle = make_handle(WorkflowExecutionStatus.RUNNING)
    handle.query = AsyncMock(side_effect=RPCError("gone", RPCStatusCode.NOT_FOUND, b""))
    temporal = make_temporal(handle)

    response = await request("GET", SYNC_URL, session, temporal=temporal, user=make_user())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "running"
    assert all(step["status"] == "pending" for step in body["steps"])


# --- activities ---


def patch_session_factory(monkeypatch: pytest.MonkeyPatch, session: AsyncMock) -> None:
    @asynccontextmanager
    async def factory():
        yield session

    monkeypatch.setattr("app.sync_activities.session_factory", factory)


def make_activities() -> SyncActivities:
    return SyncActivities(MagicMock(), MagicMock(), MagicMock(), MagicMock())


async def test_sync_artists_activity_commits_and_wraps_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    patch_session_factory(monkeypatch, session)
    sync = AsyncMock(return_value=ARTIST_RESULT.results)
    monkeypatch.setattr("app.sync_activities.sync_lastfm_artists", sync)

    result = await make_activities().sync_artists(str(USER_ID))

    assert result.results == ARTIST_RESULT.results
    sync.assert_awaited_once()
    session.commit.assert_awaited_once()


async def test_sync_artists_activity_without_link_is_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)
    patch_session_factory(monkeypatch, session)

    with pytest.raises(ApplicationError) as excinfo:
        await make_activities().sync_artists(str(USER_ID))

    assert excinfo.value.non_retryable
    session.commit.assert_not_awaited()


async def test_sync_artists_activity_without_city_is_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Ada", include_known_artists=True)
    patch_session_factory(monkeypatch, session)

    with pytest.raises(ApplicationError) as excinfo:
        await make_activities().sync_artists(str(USER_ID))

    assert excinfo.value.non_retryable
    session.commit.assert_not_awaited()


async def test_sync_events_activity_for_unknown_user_is_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    session.get.return_value = None
    patch_session_factory(monkeypatch, session)

    with pytest.raises(ApplicationError) as excinfo:
        await make_activities().sync_events(str(USER_ID))

    assert excinfo.value.non_retryable


# --- workflow ---


async def test_user_facing_errors_masks_unexpected_exception() -> None:
    raw = "canceling statement due to statement timeout [SQL: UPDATE lastfm_artists ...]"
    with pytest.raises(ApplicationError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise RuntimeError(raw)
    assert caught.value.message == STEP_FAILED_SUGGESTIONS
    # Retryable, since the underlying cause may be transient.
    assert caught.value.non_retryable is False
    # The raw cause is preserved for the logs and Temporal history, not shown.
    assert isinstance(caught.value.__cause__, RuntimeError)
    assert raw not in caught.value.message


async def test_user_facing_errors_passes_through_application_error() -> None:
    with pytest.raises(ApplicationError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise ApplicationError("No home city set", non_retryable=True)
    assert caught.value.message == "No home city set"
    assert caught.value.non_retryable is True


async def test_user_facing_errors_keeps_actionable_private_data_message() -> None:
    with pytest.raises(ApplicationError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise LastfmPrivateDataError("rj")
    assert caught.value.message == str(LastfmPrivateDataError("rj"))
    assert caught.value.non_retryable is True


async def test_user_facing_errors_masks_operator_only_spotify_auth() -> None:
    with pytest.raises(ApplicationError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise SpotifyAuthError("Re-run `python -m app.spotify_auth` as the bot account.")
    assert caught.value.message == "Spotify is temporarily unavailable. Please try again later."
    assert "spotify_auth" not in caught.value.message
    assert caught.value.non_retryable is True


@activity.defn(name="sync_artists")
async def fake_sync_artists(user_id: str) -> ArtistSyncResult:
    return ARTIST_RESULT


@activity.defn(name="sync_suggestions")
async def fake_sync_suggestions(user_id: str) -> SuggestionSyncResult:
    return SUGGESTION_RESULT


@activity.defn(name="sync_suggestions")
async def failing_sync_suggestions(user_id: str) -> SuggestionSyncResult:
    raise ApplicationError("Last.fm exploded", non_retryable=True)


@activity.defn(name="sync_events")
async def fake_sync_events(user_id: str) -> EventSyncResult:
    return EVENT_RESULT


@activity.defn(name="sync_playlists")
async def fake_sync_playlists(user_id: str) -> PlaylistSyncResult:
    return PLAYLIST_RESULT


def record_activity(recorded: list[str]):
    @activity.defn(name="record_sync_completed")
    async def record_sync_completed(user_id: str) -> None:
        recorded.append(user_id)

    return record_sync_completed


def list_activity(user_ids: list[uuid.UUID]):
    @activity.defn(name="list_users_due_for_sync")
    async def list_users_due_for_sync() -> list[str]:
        return [str(user_id) for user_id in user_ids]

    return list_users_due_for_sync


@activity.defn(name="audit_bot_playlists")
async def fake_audit_bot_playlists() -> int:
    return 0


@activity.defn(name="drain_playlist_tombstones")
async def fake_drain_playlist_tombstones() -> TombstoneDrainResult:
    return TombstoneDrainResult(drained=0, pending=0)


CLEANUP_ACTIVITIES = [fake_audit_bot_playlists, fake_drain_playlist_tombstones]


async def test_workflow_runs_all_steps_in_order() -> None:
    recorded: list[str] = []
    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[SyncUserWorkflow],
            activities=[
                fake_sync_artists,
                fake_sync_suggestions,
                fake_sync_events,
                fake_sync_playlists,
                record_activity(recorded),
            ],
        ):
            result = await env.client.execute_workflow(
                SyncUserWorkflow.run,
                str(USER_ID),
                id=user_sync_workflow_id(USER_ID),
                task_queue="test-sync",
            )

    assert [step.key for step in result.steps] == [
        "artists",
        "suggestions",
        "events",
        "playlists",
    ]
    assert all(step.status == "completed" for step in result.steps)
    assert all(step.finished_at is not None for step in result.steps)
    assert result.steps[0].summary == "Imported 4 artists · 3 added, 1 updated, 0 removed"
    assert result.steps[3].summary == (
        "Generated 0 playlists · 0 tracks added, 0 removed · "
        "6 artists with concerts nearby, 1 not found on Spotify"
    )
    assert recorded == [str(USER_ID)]


async def test_workflow_stops_at_first_failed_step() -> None:
    recorded: list[str] = []
    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[SyncUserWorkflow],
            activities=[
                fake_sync_artists,
                failing_sync_suggestions,
                fake_sync_events,
                fake_sync_playlists,
                record_activity(recorded),
            ],
        ):
            handle = await env.client.start_workflow(
                SyncUserWorkflow.run,
                str(USER_ID),
                id=user_sync_workflow_id(USER_ID),
                task_queue="test-sync",
            )
            with pytest.raises(WorkflowFailureError):
                await handle.result()

            steps = await handle.query(SyncUserWorkflow.progress)

    assert [step.status for step in steps] == ["completed", "failed", "pending", "pending"]
    assert [step.finished_at is not None for step in steps] == [True, True, False, False]
    assert steps[0].summary is not None
    assert steps[1].summary == "Last.fm exploded"
    assert recorded == []


async def test_workflow_does_not_retry_private_lastfm_data() -> None:
    recorded: list[str] = []
    attempts = 0

    @activity.defn(name="sync_artists")
    async def private_sync_artists(user_id: str) -> ArtistSyncResult:
        nonlocal attempts
        attempts += 1
        raise LastfmPrivateDataError("rj")

    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[SyncUserWorkflow],
            activities=[
                private_sync_artists,
                fake_sync_suggestions,
                fake_sync_events,
                fake_sync_playlists,
                record_activity(recorded),
            ],
        ):
            handle = await env.client.start_workflow(
                SyncUserWorkflow.run,
                str(USER_ID),
                id=user_sync_workflow_id(USER_ID),
                task_queue="test-sync",
            )
            with pytest.raises(WorkflowFailureError):
                await handle.result()

            steps = await handle.query(SyncUserWorkflow.progress)

    assert attempts == 1
    assert [step.status for step in steps] == ["failed", "pending", "pending", "pending"]
    assert steps[0].summary == str(LastfmPrivateDataError("rj"))
    assert recorded == []


# --- dispatch ---

OTHER_USER_ID = uuid.uuid7()


async def test_dispatch_syncs_each_listed_user_in_order() -> None:
    recorded: list[str] = []
    synced: list[str] = []

    @activity.defn(name="sync_artists")
    async def tracking_sync_artists(user_id: str) -> ArtistSyncResult:
        synced.append(user_id)
        return ARTIST_RESULT

    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[DispatchSyncsWorkflow, SyncUserWorkflow],
            activities=[
                list_activity([USER_ID, OTHER_USER_ID]),
                tracking_sync_artists,
                fake_sync_suggestions,
                fake_sync_events,
                fake_sync_playlists,
                record_activity(recorded),
                *CLEANUP_ACTIVITIES,
            ],
        ):
            result = await env.client.execute_workflow(
                DispatchSyncsWorkflow.run,
                id="dispatch-syncs",
                task_queue="test-sync",
            )

    assert synced == [str(USER_ID), str(OTHER_USER_ID)]
    assert recorded == synced
    assert result == DispatchSyncsResult(dispatched=2, succeeded=2, failed=0, skipped=0)


async def test_dispatch_isolates_child_failures() -> None:
    recorded: list[str] = []

    @activity.defn(name="sync_suggestions")
    async def failing_for_first_user(user_id: str) -> SuggestionSyncResult:
        if user_id == str(USER_ID):
            raise ApplicationError("Last.fm exploded", non_retryable=True)
        return SUGGESTION_RESULT

    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[DispatchSyncsWorkflow, SyncUserWorkflow],
            activities=[
                list_activity([USER_ID, OTHER_USER_ID]),
                *CLEANUP_ACTIVITIES,
                fake_sync_artists,
                failing_for_first_user,
                fake_sync_events,
                fake_sync_playlists,
                record_activity(recorded),
            ],
        ):
            result = await env.client.execute_workflow(
                DispatchSyncsWorkflow.run,
                id="dispatch-syncs",
                task_queue="test-sync",
            )

    assert result == DispatchSyncsResult(dispatched=2, succeeded=1, failed=1, skipped=0)
    assert recorded == [str(OTHER_USER_ID)]


async def test_dispatch_skips_user_whose_sync_is_already_running() -> None:
    recorded: list[str] = []
    release = asyncio.Event()

    @activity.defn(name="sync_artists")
    async def blocking_sync_artists(user_id: str) -> ArtistSyncResult:
        if user_id == str(USER_ID):
            await release.wait()
        return ARTIST_RESULT

    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[DispatchSyncsWorkflow, SyncUserWorkflow],
            activities=[
                list_activity([USER_ID, OTHER_USER_ID]),
                blocking_sync_artists,
                fake_sync_suggestions,
                fake_sync_events,
                fake_sync_playlists,
                record_activity(recorded),
                *CLEANUP_ACTIVITIES,
            ],
        ):
            manual = await env.client.start_workflow(
                SyncUserWorkflow.run,
                str(USER_ID),
                id=user_sync_workflow_id(USER_ID),
                task_queue="test-sync",
            )
            result = await env.client.execute_workflow(
                DispatchSyncsWorkflow.run,
                id="dispatch-syncs",
                task_queue="test-sync",
            )
            release.set()
            await manual.result()

    assert result == DispatchSyncsResult(dispatched=2, succeeded=1, failed=0, skipped=1)
    assert recorded == [str(OTHER_USER_ID), str(USER_ID)]


async def test_dispatch_reports_cleanup_counts() -> None:
    @activity.defn(name="audit_bot_playlists")
    async def finding_audit() -> int:
        return 2

    @activity.defn(name="drain_playlist_tombstones")
    async def busy_drain() -> TombstoneDrainResult:
        return TombstoneDrainResult(drained=3, pending=1)

    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[DispatchSyncsWorkflow, SyncUserWorkflow],
            activities=[list_activity([]), finding_audit, busy_drain],
        ):
            result = await env.client.execute_workflow(
                DispatchSyncsWorkflow.run,
                id="dispatch-syncs",
                task_queue="test-sync",
            )

    assert result.orphans_found == 2
    assert result.tombstones_drained == 3
    assert result.tombstones_pending == 1


async def test_dispatch_survives_cleanup_failure_and_still_drains() -> None:
    @activity.defn(name="audit_bot_playlists")
    async def failing_audit() -> int:
        raise ApplicationError("Spotify exploded", non_retryable=True)

    @activity.defn(name="drain_playlist_tombstones")
    async def busy_drain() -> TombstoneDrainResult:
        return TombstoneDrainResult(drained=3, pending=1)

    async with await WorkflowEnvironment.start_time_skipping(
        data_converter=pydantic_data_converter
    ) as env:
        async with Worker(
            env.client,
            task_queue="test-sync",
            workflows=[DispatchSyncsWorkflow, SyncUserWorkflow],
            activities=[list_activity([]), failing_audit, busy_drain],
        ):
            result = await env.client.execute_workflow(
                DispatchSyncsWorkflow.run,
                id="dispatch-syncs",
                task_queue="test-sync",
            )

    # The night's syncs stand, and a broken audit never gates the drainer.
    assert result.orphans_found == 0
    assert result.tombstones_drained == 3
    assert result.tombstones_pending == 1


async def test_audit_bot_playlists_activity_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    patch_session_factory(monkeypatch, session)
    audit = AsyncMock(return_value=2)
    monkeypatch.setattr("app.sync_activities.audit_bot_playlists", audit)

    result = await make_activities().audit_bot_playlists()

    assert result == 2
    audit.assert_awaited_once()
    session.commit.assert_awaited_once()


async def test_drain_playlist_tombstones_activity_commits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    patch_session_factory(monkeypatch, session)
    drain = AsyncMock(return_value=TombstoneDrainResult(drained=1, pending=0))
    monkeypatch.setattr("app.sync_activities.drain_playlist_tombstones", drain)

    result = await make_activities().drain_playlist_tombstones()

    assert result == TombstoneDrainResult(drained=1, pending=0)
    drain.assert_awaited_once()
    session.commit.assert_awaited_once()


async def test_record_sync_completed_activity_stamps_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    user = make_user()
    session.get.return_value = user
    patch_session_factory(monkeypatch, session)

    await make_activities().record_sync_completed(str(USER_ID))

    assert user.last_synced_at is not None
    session.commit.assert_awaited_once()


async def test_list_users_due_for_sync_activity_returns_ordered_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    session.execute.return_value = result_with_scalars([USER_ID, OTHER_USER_ID])
    patch_session_factory(monkeypatch, session)

    result = await make_activities().list_users_due_for_sync()

    assert result == [str(USER_ID), str(OTHER_USER_ID)]
