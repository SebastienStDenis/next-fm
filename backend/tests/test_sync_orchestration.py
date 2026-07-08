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

from app.models import LastfmAccount, User
from app.schemas import (
    ArtistSyncKindResult,
    ArtistSyncResult,
    EventSyncResult,
    PlaylistSyncResult,
    SuggestionSyncResult,
    SyncRunResult,
    SyncStepProgress,
)
from app.sync_activities import SyncActivities
from app.sync_workflow import SyncUserWorkflow, pending_steps, user_sync_workflow_id
from tests.helpers import make_session, request, result_returning

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
    return User(id=USER_ID, name="Ada", include_known_artists=True)


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
    steps[0].summary = "Synced 4 artists · 3 added, 1 updated, 0 removed"
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


async def test_workflow_runs_all_steps_in_order() -> None:
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
    assert result.steps[0].summary == "Synced 4 artists · 3 added, 1 updated, 0 removed"
    assert result.steps[3].summary == (
        "Synced 0 playlists · 0 tracks added, 0 removed · "
        "6 artists with shows nearby, 1 not found on Spotify"
    )


async def test_workflow_stops_at_first_failed_step() -> None:
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
    assert steps[0].summary is not None
    assert steps[1].summary == "Last.fm exploded"
