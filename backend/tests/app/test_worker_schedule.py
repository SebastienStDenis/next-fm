from datetime import UTC, datetime

from app.core.config import Settings
from app.worker import next_dispatch_at, startup_dispatch_at


def make_settings(**overrides: object) -> Settings:
    # The untyped dict keeps ty from rejecting `_env_file` (absent from
    # Settings' typed signature) and the object-typed overrides.
    values: dict = {"_env_file": None, **overrides}
    return Settings(**values)


def at(hour: int, minute: int = 0, day: int = 10) -> datetime:
    return datetime(2026, 8, day, hour, minute, tzinfo=UTC)


def test_nightly_sync_defaults_off(monkeypatch) -> None:
    monkeypatch.delenv("NIGHTLY_SYNC_ENABLED", raising=False)
    assert make_settings().nightly_sync_enabled is False


def test_next_dispatch_is_today_before_the_firing_hour() -> None:
    assert next_dispatch_at(at(5, 59)) == at(6)


def test_next_dispatch_is_tomorrow_from_the_firing_hour_on() -> None:
    assert next_dispatch_at(at(6)) == at(6, day=11)
    assert next_dispatch_at(at(23, 30)) == at(6, day=11)


def test_startup_dispatches_now_inside_the_catchup_window() -> None:
    assert startup_dispatch_at(at(6)) == at(6)
    assert startup_dispatch_at(at(6, 45)) == at(6, 45)


def test_startup_waits_for_the_next_firing_outside_the_window() -> None:
    assert startup_dispatch_at(at(7)) == at(6, day=11)
    assert startup_dispatch_at(at(5, 30)) == at(6)
