import uuid
from datetime import UTC, datetime

from app.core.models import LastfmAccount, SyncRun, User
from app.sync.sync_pipeline import pending_steps
from tests.helpers import make_session, request, result_returning

USER_ID = uuid.uuid7()
RUN_ID = uuid.uuid7()
SYNC_URL = "/me/sync"
CREATED_AT = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)
FINISHED_AT = datetime(2026, 7, 7, 12, 5, tzinfo=UTC)


def make_user() -> User:
    return User(id=USER_ID, name="Ada", include_known_artists=True, city_id=6077243)


def make_account() -> LastfmAccount:
    return LastfmAccount(id=uuid.uuid7(), username="rj")


def make_run(status: str, steps: list | None = None, **fields: object) -> SyncRun:
    progress = steps if steps is not None else pending_steps()
    return SyncRun(
        id=RUN_ID,
        user_id=USER_ID,
        trigger="manual",
        status=status,
        steps=[step.model_dump(mode="json") for step in progress],
        created_at=CREATED_AT,
        **fields,
    )


# --- POST /me/sync ---


async def test_start_sync_requires_authentication() -> None:
    session = make_session()

    response = await request("POST", SYNC_URL, session)

    assert response.status_code == 401
    session.execute.assert_not_awaited()


async def test_start_sync_when_not_linked() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("POST", SYNC_URL, session, user=make_user())

    assert response.status_code == 404
    assert response.json()["detail"] == "No Last.fm account linked"
    session.commit.assert_not_awaited()


async def test_start_sync_when_no_home_city() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_account())
    user = User(id=USER_ID, name="Ada", include_known_artists=True)

    response = await request("POST", SYNC_URL, session, user=user)

    assert response.status_code == 404
    assert response.json()["detail"] == "No home city set"
    session.commit.assert_not_awaited()


async def test_start_sync_enqueues_run() -> None:
    session = make_session()
    # The account lookup, then the insert's RETURNING row.
    session.execute.side_effect = [
        result_returning(make_account()),
        result_returning(make_run("queued")),
    ]

    response = await request("POST", SYNC_URL, session, user=make_user())

    assert response.status_code == 202
    assert response.json() == {"run_id": str(RUN_ID), "status": "running"}
    session.commit.assert_awaited_once()


async def test_start_sync_attaches_to_active_run() -> None:
    session = make_session()
    # The insert conflicts (no row back), so the active run is looked up.
    session.execute.side_effect = [
        result_returning(make_account()),
        result_returning(None),
        result_returning(make_run("running")),
    ]

    response = await request("POST", SYNC_URL, session, user=make_user())

    assert response.status_code == 202
    assert response.json()["run_id"] == str(RUN_ID)


# --- GET /me/sync ---


async def test_sync_status_without_any_run() -> None:
    session = make_session()
    session.execute.return_value = result_returning(None)

    response = await request("GET", SYNC_URL, session, user=make_user())

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
    steps[0].summary = "Imported 4 artists · 3 added"
    steps[0].finished_at = FINISHED_AT
    steps[1].status = "running"
    session.execute.return_value = result_returning(make_run("running", steps))

    response = await request("GET", SYNC_URL, session, user=make_user())

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "running"
    assert body["started_at"] == "2026-07-07T12:00:00Z"
    assert body["finished_at"] is None
    assert body["steps"][0]["status"] == "completed"
    assert body["steps"][0]["summary"] == steps[0].summary
    assert body["steps"][0]["finished_at"] == "2026-07-07T12:05:00Z"
    assert body["steps"][1]["status"] == "running"
    assert body["steps"][2]["status"] == "pending"


async def test_sync_status_queued_reads_as_running() -> None:
    session = make_session()
    session.execute.return_value = result_returning(make_run("queued"))

    response = await request("GET", SYNC_URL, session, user=make_user())

    assert response.status_code == 200
    assert response.json()["status"] == "running"


async def test_sync_status_maps_terminal_statuses() -> None:
    session = make_session()
    for status in ("completed", "failed"):
        session.execute.return_value = result_returning(make_run(status, finished_at=FINISHED_AT))

        response = await request("GET", SYNC_URL, session, user=make_user())

        assert response.status_code == 200
        assert response.json()["status"] == status
        assert response.json()["finished_at"] == "2026-07-07T12:05:00Z"
