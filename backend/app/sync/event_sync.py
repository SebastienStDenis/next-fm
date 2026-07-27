import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.bandsintown import (
    BandsintownApiError,
    BandsintownArtistNotFoundError,
    BandsintownClient,
    BandsintownEventData,
)
from app.core.models import (
    Artist,
    BandsintownArtist,
    BandsintownEvent,
    Event,
    EventArtist,
    User,
    UserArtistInterest,
)
from app.core.schemas import EventSyncResult
from app.sync.matching import artist_qualifies

EVENT_SYNC_TTL = timedelta(hours=24)
FETCH_CONCURRENCY = 8


async def sync_user_events(
    session: AsyncSession, bandsintown: BandsintownClient, user: User
) -> EventSyncResult:
    """Refresh upcoming events for every artist the user has an interest in."""
    result = await session.execute(
        select(Artist)
        .join(UserArtistInterest, UserArtistInterest.artist_id == Artist.id)
        .where(UserArtistInterest.user_id == user.id)
        .distinct()
    )
    artists = list(result.scalars())

    result = await session.execute(
        select(BandsintownArtist).where(
            BandsintownArtist.artist_id.in_([artist.id for artist in artists])
        )
    )
    identities = {identity.artist_id: identity for identity in result.scalars()}

    now = datetime.now(UTC)
    skipped = 0
    to_fetch: list[Artist] = []
    for artist in artists:
        identity = identities.get(artist.id)
        if identity and identity.last_synced_at and now - identity.last_synced_at < EVENT_SYNC_TTL:
            skipped += 1
        else:
            to_fetch.append(artist)

    lookup_names = [
        identities[artist.id].name if artist.id in identities else artist.name
        for artist in to_fetch
    ]
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    outcomes = await asyncio.gather(
        *(_fetch_artist_events(bandsintown, name, semaphore) for name in lookup_names)
    )

    synced = unknown = failed = 0
    created = updated = removed = 0
    for artist, (status, events) in zip(to_fetch, outcomes, strict=True):
        if status == "failed":
            # Leave last_synced_at untouched so the next sync retries.
            failed += 1
            continue
        identity = identities.get(artist.id) or await _get_or_create_identity(session, artist)
        if status == "unknown":
            unknown += 1
        else:
            synced += 1
            # Re-stamp on every fetch: if Bandsintown re-points the name to a
            # different artist, the stored identity heals within a TTL.
            if events:
                identity.external_id = events[0].artist_external_id
        identity.last_synced_at = now

        artist_created, artist_updated = await _upsert_artist_events(session, artist.id, events)
        created += artist_created
        updated += artist_updated
        if status == "synced":
            # Only delete after a successful sync
            removed += await _prune_events(session, artist.id, events, now)

    # Post-sync state for the step summary: every upcoming concert the
    # Concerts tab can surface for this user, searching any city.
    result = await session.execute(
        select(func.count(func.distinct(Event.id)))
        .select_from(Event)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .where(
            artist_qualifies(user.id, EventArtist.artist_id, user.include_known_artists),
            Event.starts_at > now,
        )
    )
    total = result.scalar_one()

    return EventSyncResult(
        synced_at=now,
        artists_total=len(artists),
        artists_synced=synced,
        artists_skipped=skipped,
        artists_unknown=unknown,
        artists_failed=failed,
        events_created=created,
        events_updated=updated,
        events_removed=removed,
        events_total=total,
    )


async def _fetch_artist_events(
    bandsintown: BandsintownClient, name: str, semaphore: asyncio.Semaphore
) -> tuple[str, list[BandsintownEventData]]:
    async with semaphore:
        try:
            return "synced", await bandsintown.get_artist_events(name)
        except BandsintownArtistNotFoundError:
            return "unknown", []
        except BandsintownApiError:
            return "failed", []


async def _get_or_create_identity(session: AsyncSession, artist: Artist) -> BandsintownArtist:
    """Insert-then-select so a concurrent sync creating the same identity
    row is adopted instead of raising on the unique constraint."""
    await session.execute(
        pg_insert(BandsintownArtist)
        .values(artist_id=artist.id, name=artist.name)
        .on_conflict_do_nothing(index_elements=[BandsintownArtist.artist_id])
    )
    result = await session.execute(
        select(BandsintownArtist).where(BandsintownArtist.artist_id == artist.id)
    )
    return result.scalar_one()


def _apply_event_data(event: Event, data: BandsintownEventData) -> None:
    event.title = data.title
    event.venue_name = data.venue_name
    event.venue_latitude = data.venue_latitude
    event.venue_longitude = data.venue_longitude
    event.street_address = data.street_address
    event.city_name = data.city_name
    event.region = data.region
    event.country = data.country
    event.starts_at = data.starts_at


async def _upsert_artist_events(
    session: AsyncSession, artist_id: uuid.UUID, events: list[BandsintownEventData]
) -> tuple[int, int]:
    events = list({data.external_id: data for data in events}.values())
    if not events:
        return 0, 0

    result = await session.execute(
        select(BandsintownEvent, Event)
        .join(Event, BandsintownEvent.event_id == Event.id)
        .where(BandsintownEvent.external_id.in_([data.external_id for data in events]))
    )
    existing = {source.external_id: (source, event) for source, event in result.all()}

    created = updated = 0
    event_ids = []
    created_events: list[tuple[Event, BandsintownEventData]] = []
    for data in events:
        pair = existing.get(data.external_id)
        if pair is None:
            event = Event(id=uuid.uuid7())
            _apply_event_data(event, data)
            session.add(event)
            created_events.append((event, data))
            created += 1
        else:
            source, event = pair
            _apply_event_data(event, data)
            source.url = data.url
            source.lineup = data.lineup
            updated += 1
        event_ids.append(event.id)

    # Flush new events before inserting BandsintownEvents (dependency order)
    await session.flush()
    if created_events:
        stmt = pg_insert(BandsintownEvent).values(
            [
                {
                    "event_id": event.id,
                    "external_id": data.external_id,
                    "url": data.url,
                    "lineup": data.lineup,
                }
                for event, data in created_events
            ]
        )
        # A concurrent sync may have created the same source row between our
        # select and this insert; on conflict, adopt its canonical event and
        # drop the duplicate we just made.
        stmt = stmt.on_conflict_do_update(
            index_elements=[BandsintownEvent.external_id],
            set_={"url": stmt.excluded.url, "lineup": stmt.excluded.lineup},
        ).returning(BandsintownEvent.external_id, BandsintownEvent.event_id)
        result = await session.execute(stmt)
        ours_by_external = {data.external_id: event for event, data in created_events}
        for external_id, event_id in result.all():
            ours = ours_by_external[external_id]
            if event_id != ours.id:
                await session.delete(ours)
                event_ids[event_ids.index(ours.id)] = event_id
                created -= 1
                updated += 1

    await session.execute(
        pg_insert(EventArtist)
        .values([{"event_id": event_id, "artist_id": artist_id} for event_id in event_ids])
        .on_conflict_do_nothing()
    )
    return created, updated


async def _prune_events(
    session: AsyncSession,
    artist_id: uuid.UUID,
    events: list[BandsintownEventData],
    now: datetime,
) -> int:
    """Delete this artist's future events that disappeared from their feed;
    the cascade cleans up source rows and lineup links."""
    to_prune = (
        select(Event.id)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .join(BandsintownEvent, BandsintownEvent.event_id == Event.id)
        .where(EventArtist.artist_id == artist_id, Event.starts_at > now)
    )
    if events:
        to_prune = to_prune.where(
            BandsintownEvent.external_id.notin_([data.external_id for data in events])
        )
    result = await session.execute(to_prune)
    to_prune_ids = list(result.scalars())
    if to_prune_ids:
        await session.execute(delete(Event).where(Event.id.in_(to_prune_ids)))
    return len(to_prune_ids)
