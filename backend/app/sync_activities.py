"""Temporal activities wrapping the four per-user sync entrypoints, plus the
bookkeeping the nightly dispatch needs (eligibility listing and the
last-synced stamp; see docs/design/2026-07-09-background-sync-plan.md).

Each activity is its own transaction: it opens a fresh session, re-fetches the
user (so retries never see stale ORM state), runs the existing sync module
unchanged, and commits. The API clients are owned by the worker process for
its whole lifetime; in particular a single shared MusicBrainzClient is what
preserves the MusicBrainz 1 req/s guarantee across activities.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from temporalio import activity
from temporalio.exceptions import ApplicationError

from app.accounts import linked_lastfm_account
from app.artist_sync import SYNC_KINDS, sync_lastfm_artists
from app.bandsintown import BandsintownClient
from app.db import session_factory
from app.event_sync import sync_user_events
from app.lastfm import LastfmClient
from app.models import LastfmAccount, LastfmConnection, User
from app.musicbrainz import MusicBrainzClient
from app.playlist_sync import sync_user_playlists
from app.schemas import (
    ArtistSyncResult,
    EventSyncResult,
    PlaylistSyncResult,
    SuggestionSyncResult,
)
from app.spotify import SpotifyClient
from app.suggestion_sync import sync_user_suggestions

ACTIVITY_WINDOW = timedelta(days=30)
# Below the daily cadence on purpose: a 24h threshold against a 24h schedule
# would skip users whose previous run finished minutes after the firing time.
SYNC_FRESHNESS_WINDOW = timedelta(hours=20)


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
        async with session_factory() as session:
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
        async with session_factory() as session:
            user = await _require_user(session, user_id)
            account = await _require_lastfm_account(session, user.id)
            result = await sync_user_suggestions(session, self._lastfm, user, account.username)
            await session.commit()
            return result

    @activity.defn
    async def sync_events(self, user_id: str) -> EventSyncResult:
        async with session_factory() as session:
            user = await _require_user(session, user_id)
            result = await sync_user_events(session, self._bandsintown, user.id)
            await session.commit()
            return result

    @activity.defn
    async def sync_playlists(self, user_id: str) -> PlaylistSyncResult:
        async with session_factory() as session:
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
    async def list_users_due_for_sync(self) -> list[str]:
        now = datetime.now(UTC)
        async with session_factory() as session:
            result = await session.execute(
                select(User.id)
                .join(LastfmConnection, LastfmConnection.user_id == User.id)
                .where(User.city_id.is_not(None))
                .where(User.last_seen_at >= now - ACTIVITY_WINDOW)
                .where(
                    or_(
                        User.last_synced_at.is_(None),
                        User.last_synced_at < now - SYNC_FRESHNESS_WINDOW,
                    )
                )
                .order_by(User.last_synced_at.asc().nulls_first())
            )
            return [str(user_id) for user_id in result.scalars()]
