"""Temporal activities wrapping the four per-user sync entrypoints, plus the
bookkeeping the nightly dispatch needs (eligibility listing and the
last-synced stamp; see docs/design/2026-07-09-background-sync-plan.md) and
the playlist cleanup pair (orphan audit and tombstone drain;
docs/design/2026-07-10-playlist-deletion-plan.md).

Each activity is its own transaction: it opens a fresh session, re-fetches the
user (so retries never see stale ORM state), runs the existing sync module
unchanged, and commits. The API clients are owned by the worker process for
its whole lifetime; in particular a single shared MusicBrainzClient is what
preserves the MusicBrainz 1 req/s guarantee across activities.
"""

import contextlib
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from temporalio import activity
from temporalio.exceptions import ApplicationError

from app.clients.bandsintown import BandsintownClient
from app.clients.lastfm import LastfmClient, LastfmPrivateDataError
from app.clients.musicbrainz import MusicBrainzClient
from app.clients.spotify import SpotifyAuthError, SpotifyClient
from app.core.accounts import linked_lastfm_account
from app.core.db import session_factory
from app.core.models import LastfmAccount, LastfmConnection, User
from app.core.schemas import (
    ArtistSyncResult,
    EventSyncResult,
    PlaylistSyncResult,
    SuggestionSyncResult,
    TombstoneDrainResult,
)
from app.sync.artist_sync import SYNC_KINDS, sync_lastfm_artists
from app.sync.event_sync import sync_user_events
from app.sync.playlist_sync import (
    audit_bot_playlists,
    drain_playlist_tombstones,
    sync_user_playlists,
)
from app.sync.suggestion_sync import sync_user_suggestions

logger = logging.getLogger(__name__)

# Below the daily cadence on purpose: a 24h threshold against a 24h schedule
# would skip users whose previous run finished minutes after the firing time.
SYNC_FRESHNESS_WINDOW = timedelta(hours=20)

# What the user sees when a step fails for an unexpected reason. The raw cause
# (a driver, HTTP, or timeout message) must never reach the UI, so each step
# falls back to its own line; the real failure stays in the logs and in
# Temporal history via the preserved exception cause.
STEP_FAILED_ARTISTS = "We couldn't import your Last.fm listening history. Please try again."
STEP_FAILED_SUGGESTIONS = "We couldn't refresh your artist suggestions. Please try again."
STEP_FAILED_EVENTS = "We couldn't check for upcoming concerts. Please try again."
STEP_FAILED_PLAYLISTS = "We couldn't update your Spotify playlists. Please try again."


@contextlib.asynccontextmanager
async def _user_facing_errors(fallback: str) -> AsyncIterator[None]:
    """Ensure a failing sync step surfaces only a message safe for the user.

    Curated `ApplicationError` preconditions and the already-actionable
    `LastfmPrivateDataError` pass through unchanged; every other exception
    becomes a generic step message. The original is chained with
    `raise ... from`, so Temporal history and the worker log keep the real
    cause for debugging.
    """
    try:
        yield
    except ApplicationError:
        raise
    except LastfmPrivateDataError as exc:
        # Phrased for the user and fixable only by them - never worth a retry.
        raise ApplicationError(str(exc), non_retryable=True) from exc
    except SpotifyAuthError as exc:
        # The detail names an operator-only CLI step; the user can only wait.
        logger.warning("Spotify authorization failed during sync", exc_info=exc)
        raise ApplicationError(
            "Spotify is temporarily unavailable. Please try again later.",
            non_retryable=True,
        ) from exc
    except Exception as exc:
        logger.warning("Sync step failed: %s", fallback, exc_info=exc)
        raise ApplicationError(fallback) from exc


async def _require_user(session: AsyncSession, user_id: str) -> User:
    user = await session.get(User, uuid.UUID(user_id))
    if user is None:
        raise ApplicationError("User not found", non_retryable=True)
    return user


async def _require_lastfm_account(session: AsyncSession, user_id: uuid.UUID) -> LastfmAccount:
    account = await linked_lastfm_account(session, user_id)
    if account is None:
        raise ApplicationError("No Last.fm account linked", non_retryable=True)
    return account


def _require_home_city(user: User) -> None:
    # The pipeline is all-or-nothing: without a city there is no playlist to
    # build, so fail on step 1 instead of running a partial sync.
    if user.city_id is None:
        raise ApplicationError("No home city set", non_retryable=True)


class SyncActivities:
    def __init__(
        self,
        lastfm: LastfmClient,
        bandsintown: BandsintownClient,
        spotify: SpotifyClient,
        musicbrainz: MusicBrainzClient,
    ) -> None:
        self._lastfm = lastfm
        self._bandsintown = bandsintown
        self._spotify = spotify
        self._musicbrainz = musicbrainz

    @activity.defn
    async def sync_artists(self, user_id: str) -> ArtistSyncResult:
        async with _user_facing_errors(STEP_FAILED_ARTISTS), session_factory() as session:
            user = await _require_user(session, user_id)
            _require_home_city(user)
            account = await _require_lastfm_account(session, user.id)
            results = await sync_lastfm_artists(
                session, self._lastfm, user.id, account.username, SYNC_KINDS
            )
            await session.commit()
            return ArtistSyncResult(synced_at=datetime.now(UTC), results=results)

    @activity.defn
    async def sync_suggestions(self, user_id: str) -> SuggestionSyncResult:
        async with _user_facing_errors(STEP_FAILED_SUGGESTIONS), session_factory() as session:
            user = await _require_user(session, user_id)
            account = await _require_lastfm_account(session, user.id)
            result = await sync_user_suggestions(
                session, self._lastfm, self._musicbrainz, user, account.username
            )
            await session.commit()
            return result

    @activity.defn
    async def sync_events(self, user_id: str) -> EventSyncResult:
        async with _user_facing_errors(STEP_FAILED_EVENTS), session_factory() as session:
            user = await _require_user(session, user_id)
            result = await sync_user_events(session, self._bandsintown, user.id)
            await session.commit()
            return result

    @activity.defn
    async def sync_playlists(self, user_id: str) -> PlaylistSyncResult:
        async with _user_facing_errors(STEP_FAILED_PLAYLISTS), session_factory() as session:
            user = await _require_user(session, user_id)
            result = await sync_user_playlists(
                session, self._spotify, self._lastfm, self._musicbrainz, user
            )
            await session.commit()
            return result

    @activity.defn
    async def record_sync_completed(self, user_id: str) -> None:
        async with session_factory() as session:
            user = await _require_user(session, user_id)
            user.last_synced_at = datetime.now(UTC)
            await session.commit()

    @activity.defn
    async def audit_bot_playlists(self) -> int:
        async with session_factory() as session:
            found = await audit_bot_playlists(session, self._spotify)
            await session.commit()
            return found

    @activity.defn
    async def drain_playlist_tombstones(self) -> TombstoneDrainResult:
        async with session_factory() as session:
            result = await drain_playlist_tombstones(session, self._spotify)
            await session.commit()
            return result

    @activity.defn
    async def list_users_due_for_sync(self) -> list[str]:
        now = datetime.now(UTC)
        async with session_factory() as session:
            result = await session.execute(
                select(User.id)
                .join(LastfmConnection, LastfmConnection.user_id == User.id)
                .where(User.city_id.is_not(None))
                .where(
                    or_(
                        User.last_synced_at.is_(None),
                        User.last_synced_at < now - SYNC_FRESHNESS_WINDOW,
                    )
                )
                .order_by(User.last_synced_at.asc().nulls_first())
            )
            return [str(user_id) for user_id in result.scalars()]
