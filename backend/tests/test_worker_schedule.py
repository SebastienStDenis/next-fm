from unittest.mock import AsyncMock, MagicMock

import pytest
from temporalio.client import ScheduleAlreadyRunningError
from temporalio.service import RPCError, RPCStatusCode

from app.config import Settings
from app.worker import SCHEDULE_ID, _reconcile_nightly_schedule


def make_settings(**overrides: object) -> Settings:
    defaults: dict = {"_env_file": None}
    defaults.update(overrides)
    return Settings(**defaults)


def make_client() -> MagicMock:
    client = MagicMock()
    client.create_schedule = AsyncMock()
    client.get_schedule_handle.return_value.delete = AsyncMock()
    return client


def test_nightly_sync_defaults_off() -> None:
    assert make_settings().nightly_sync_enabled is False


async def test_enabled_creates_schedule() -> None:
    client = make_client()

    await _reconcile_nightly_schedule(client, make_settings(nightly_sync_enabled=True))

    client.create_schedule.assert_awaited_once()
    assert client.create_schedule.await_args.args[0] == SCHEDULE_ID
    client.get_schedule_handle.assert_not_called()


async def test_enabled_tolerates_existing_schedule() -> None:
    client = make_client()
    client.create_schedule.side_effect = ScheduleAlreadyRunningError()

    await _reconcile_nightly_schedule(client, make_settings(nightly_sync_enabled=True))


async def test_disabled_deletes_schedule() -> None:
    client = make_client()

    await _reconcile_nightly_schedule(client, make_settings(nightly_sync_enabled=False))

    client.create_schedule.assert_not_called()
    client.get_schedule_handle.assert_called_once_with(SCHEDULE_ID)
    client.get_schedule_handle.return_value.delete.assert_awaited_once()


async def test_disabled_tolerates_missing_schedule() -> None:
    client = make_client()
    client.get_schedule_handle.return_value.delete.side_effect = RPCError(
        "schedule not found", RPCStatusCode.NOT_FOUND, b""
    )

    await _reconcile_nightly_schedule(client, make_settings(nightly_sync_enabled=False))


async def test_disabled_raises_on_unexpected_delete_error() -> None:
    client = make_client()
    client.get_schedule_handle.return_value.delete.side_effect = RPCError(
        "unavailable", RPCStatusCode.UNAVAILABLE, b""
    )

    with pytest.raises(RPCError):
        await _reconcile_nightly_schedule(client, make_settings(nightly_sync_enabled=False))
