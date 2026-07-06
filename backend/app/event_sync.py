import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.bandsintown import (
    BandsintownArtistNotFoundError,
    BandsintownClient,
    BandsintownEventData,
)
from app.models import (
    Artist,
    BandsintownArtist,
    BandsintownEvent,
    Event,
    EventArtist,
    UserArtistInterest,
)
from app.schemas import EventSyncResult

EVENT_SYNC_TTL = timedelta(hours=24)


async def sync_user_events(
    session: AsyncSession, bandsintown: BandsintownClient, user_id: uuid.UUID
) -> EventSyncResult:
    """Refresh upcoming events for every artist the user has an interest in.

    Freshness is per artist and shared globally: an artist synced within the
    TTL (by any user's request) is skipped. Each fetch is treated as the full
    truth for that artist's future events, so future events that vanished
    from the feed are deleted as cancellations.
    """
    result = await session.execute(
        select(Artist)
        .join(UserArtistInterest, UserArtistInterest.artist_id == Artist.id)
        .where(UserArtistInterest.user_id == user_id)
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
    synced = skipped = unknown = 0
    created = updated = removed = 0
    for artist in artists:
        identity = identities.get(artist.id)
        if identity and identity.last_synced_at and now - identity.last_synced_at < EVENT_SYNC_TTL:
            skipped += 1
            continue
        if identity is None:
            identity = BandsintownArtist(artist_id=artist.id, name=artist.name)
            session.add(identity)

        try:
            events = await bandsintown.get_artist_events(identity.name)
        except BandsintownArtistNotFoundError:
            events = []
            unknown += 1
        else:
            synced += 1
            if events and identity.external_id is None:
                identity.external_id = events[0].artist_external_id
        identity.last_synced_at = now

        artist_created, artist_updated = await _upsert_artist_events(session, artist.id, events)
        removed += await _remove_vanished_events(session, artist.id, events, now)
        created += artist_created
        updated += artist_updated

    return EventSyncResult(
        synced_at=now,
        artists_total=len(artists),
        artists_synced=synced,
        artists_skipped=skipped,
        artists_unknown=unknown,
        events_created=created,
        events_updated=updated,
        events_removed=removed,
    )


def _apply_event_data(event: Event, data: BandsintownEventData) -> None:
    event.title = data.title
    event.venue_name = data.venue_name
    event.venue_latitude = data.venue_latitude
    event.venue_longitude = data.venue_longitude
    event.city_name = data.city_name
    event.region = data.region
    event.country = data.country
    event.starts_at = data.starts_at


async def _upsert_artist_events(
    session: AsyncSession, artist_id: uuid.UUID, events: list[BandsintownEventData]
) -> tuple[int, int]:
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

    # Without relationships the unit of work doesn't order inserts across
    # tables, so events must be flushed before rows that FK them.
    await session.flush()
    for event, data in created_events:
        session.add(
            BandsintownEvent(
                event_id=event.id,
                external_id=data.external_id,
                url=data.url,
                lineup=data.lineup,
            )
        )
    await session.flush()
    await session.execute(
        pg_insert(EventArtist)
        .values([{"event_id": event_id, "artist_id": artist_id} for event_id in event_ids])
        .on_conflict_do_nothing()
    )
    return created, updated


async def _remove_vanished_events(
    session: AsyncSession,
    artist_id: uuid.UUID,
    events: list[BandsintownEventData],
    now: datetime,
) -> int:
    """Delete this artist's future events that disappeared from their feed;
    the cascade cleans up source rows and lineup links."""
    vanished = (
        select(Event.id)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .join(BandsintownEvent, BandsintownEvent.event_id == Event.id)
        .where(EventArtist.artist_id == artist_id, Event.starts_at > now)
    )
    if events:
        vanished = vanished.where(
            BandsintownEvent.external_id.notin_([data.external_id for data in events])
        )
    result = await session.execute(vanished)
    vanished_ids = list(result.scalars())
    if vanished_ids:
        await session.execute(delete(Event).where(Event.id.in_(vanished_ids)))
    return len(vanished_ids)
