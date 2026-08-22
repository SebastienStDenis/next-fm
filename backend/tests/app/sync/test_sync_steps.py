import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.clients.lastfm import LastfmPrivateDataError
from app.clients.spotify import SpotifyAuthError
from app.core.models import LastfmAccount, User
from app.core.schemas import ArtistSyncKindResult, TombstoneDrainResult
from app.sync.sync_steps import (
    STEP_FAILED_SUGGESTIONS,
    SyncStepError,
    SyncSteps,
    _user_facing_errors,
)
from tests.helpers import make_session, result_returning, result_with_scalars

USER_ID = uuid.uuid7()
OTHER_USER_ID = uuid.uuid7()

KIND_RESULTS = [
    ArtistSyncKindResult(
        kind="lastfm_top_artist",
        artists=3,
        interests_created=2,
        interests_updated=1,
        interests_removed=0,
    ),
]


def make_user() -> User:
    return User(id=USER_ID, name="Ada", include_known_artists=True, city_id=6077243)


def make_account() -> LastfmAccount:
    return LastfmAccount(id=uuid.uuid7(), username="rj")


def patch_session_factory(monkeypatch: pytest.MonkeyPatch, session: AsyncMock) -> None:
    @asynccontextmanager
    async def factory():
        yield session

    monkeypatch.setattr("app.sync.sync_steps.session_factory", factory)


def make_steps() -> SyncSteps:
    return SyncSteps(MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock())


async def test_sync_artists_commits_and_wraps_results(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    session.get.return_value = make_user()
    session.execute.return_value = result_returning(make_account())
    patch_session_factory(monkeypatch, session)
    sync = AsyncMock(return_value=KIND_RESULTS)
    monkeypatch.setattr("app.sync.sync_steps.sync_lastfm_artists", sync)

    result = await make_steps().sync_artists(USER_ID)

    assert result.results == KIND_RESULTS
    assert result.synced_at.tzinfo is not None
    sync.assert_awaited_once()
    session.commit.assert_awaited_once()


async def test_sync_artists_without_link_is_non_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    session.get.return_value = make_user()
    session.execute.return_value = result_returning(None)
    patch_session_factory(monkeypatch, session)

    with pytest.raises(SyncStepError) as caught:
        await make_steps().sync_artists(USER_ID)

    assert caught.value.message == "No Last.fm account linked"
    assert caught.value.retryable is False
    session.commit.assert_not_awaited()


async def test_sync_artists_without_city_is_non_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    session.get.return_value = User(id=USER_ID, name="Ada", include_known_artists=True)
    patch_session_factory(monkeypatch, session)

    with pytest.raises(SyncStepError) as caught:
        await make_steps().sync_artists(USER_ID)

    assert caught.value.message == "No home city set"
    assert caught.value.retryable is False
    session.execute.assert_not_awaited()


async def test_sync_events_for_unknown_user_is_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = make_session()
    session.get.return_value = None
    patch_session_factory(monkeypatch, session)

    with pytest.raises(SyncStepError) as caught:
        await make_steps().sync_events(USER_ID)

    assert caught.value.message == "User not found"
    assert caught.value.retryable is False


async def test_user_facing_errors_masks_unexpected_exception() -> None:
    raw = "canceling statement due to statement timeout [SQL: UPDATE lastfm_artists ...]"
    with pytest.raises(SyncStepError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise RuntimeError(raw)
    assert caught.value.message == STEP_FAILED_SUGGESTIONS
    # Retryable, since the underlying cause may be transient.
    assert caught.value.retryable is True
    # The raw cause is preserved for the logs and the run row, not shown.
    assert isinstance(caught.value.__cause__, RuntimeError)
    assert raw not in caught.value.message


async def test_user_facing_errors_passes_through_step_error() -> None:
    with pytest.raises(SyncStepError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise SyncStepError("No home city set", retryable=False)
    assert caught.value.message == "No home city set"
    assert caught.value.retryable is False


async def test_user_facing_errors_keeps_actionable_private_data_message() -> None:
    with pytest.raises(SyncStepError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise LastfmPrivateDataError("rj")
    assert caught.value.message == str(LastfmPrivateDataError("rj"))
    assert caught.value.retryable is False


async def test_user_facing_errors_masks_operator_only_spotify_auth() -> None:
    with pytest.raises(SyncStepError) as caught:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS):
            raise SpotifyAuthError("Re-run `python -m cli.spotify_auth` as the bot account.")
    assert caught.value.message == "Spotify is temporarily unavailable. Please try again later."
    assert "spotify_auth" not in caught.value.message
    assert caught.value.retryable is False


async def test_audit_bot_playlists_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    patch_session_factory(monkeypatch, session)
    audit = AsyncMock(return_value=2)
    monkeypatch.setattr("app.sync.sync_steps.audit_bot_playlists", audit)

    assert await make_steps().audit_bot_playlists() == 2
    session.commit.assert_awaited_once()


async def test_drain_playlist_tombstones_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    patch_session_factory(monkeypatch, session)
    drain = AsyncMock(return_value=TombstoneDrainResult(drained=1, pending=0))
    monkeypatch.setattr("app.sync.sync_steps.drain_playlist_tombstones", drain)

    assert await make_steps().drain_playlist_tombstones() == TombstoneDrainResult(
        drained=1, pending=0
    )
    session.commit.assert_awaited_once()


async def test_list_users_due_for_sync_returns_ordered_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    session = make_session()
    session.execute.return_value = result_with_scalars([USER_ID, OTHER_USER_ID])
    patch_session_factory(monkeypatch, session)

    result = await make_steps().list_users_due_for_sync()

    assert result == [USER_ID, OTHER_USER_ID]
