import asyncio
import math
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.ra import RaApiError, RaClient
from app.clients.source_events import SourceEventData, lookup_key
from app.clients.ticketmaster import TicketmasterApiError, TicketmasterClient
from app.core.models import (
    Artist,
    Event,
    EventArtist,
    RaArtist,
    RaEvent,
    TicketmasterArtist,
    TicketmasterEvent,
    User,
    UserArtistInterest,
)
from app.core.schemas import EventSyncResult
from app.sync.matching import artist_qualifies

EVENT_SYNC_TTL = timedelta(hours=24)
# An artist neither source knows is re-searched far less often than a
# resolved one is re-fetched: most of a taste profile never resolves, and
# probing every unknown daily would dominate the sync's runtime and quota.
UNRESOLVED_RETRY = timedelta(days=7)
FETCH_CONCURRENCY = 4
# Two source records are the same physical show when they share a linked
# artist and calendar date and their venues coincide by proximity or name.
SAME_VENUE_KM = 1.0

SOURCE_EVENT_MODELS = (TicketmasterEvent, RaEvent)

# Aggregating an artist's per-source outcomes into one reported status.
_STATUS_PRIORITY = ("synced", "failed", "unknown", "skipped")


@dataclass(frozen=True)
class _Source:
    identity_model: type[TicketmasterArtist | RaArtist]
    event_model: type[TicketmasterEvent | RaEvent]
    resolve: Callable[[str], Awaitable[str | None]]
    fetch: Callable[[str], Awaitable[list[SourceEventData]]]
    errors: tuple[type[Exception], ...]
    # Earlier sources own a shared event's display fields; a later source
    # only writes them on events with no higher-precedence source row.
    outranked_by: tuple[type[TicketmasterEvent | RaEvent], ...]


async def sync_user_events(
    session: AsyncSession, ticketmaster: TicketmasterClient, ra: RaClient, user: User
) -> EventSyncResult:
    """Refresh upcoming events for every artist the user has an interest in,
    from every source. Ticketmaster is fetched first and outranks RA wherever
    both list the same show."""
    sources = (
        _Source(
            TicketmasterArtist,
            TicketmasterEvent,
            ticketmaster.find_attraction_id,
            ticketmaster.get_attraction_events,
            (TicketmasterApiError,),
            (),
        ),
        _Source(
            RaArtist,
            RaEvent,
            ra.find_artist_id,
            ra.get_artist_events,
            (RaApiError,),
            (TicketmasterEvent,),
        ),
    )

    result = await session.execute(
        select(Artist)
        .join(UserArtistInterest, UserArtistInterest.artist_id == Artist.id)
        .where(UserArtistInterest.user_id == user.id)
        .distinct()
    )
    artists = list(result.scalars())

    now = datetime.now(UTC)
    statuses: dict[uuid.UUID, set[str]] = {artist.id: set() for artist in artists}
    created = updated = removed = 0
    for source in sources:
        source_statuses, pass_counts = await _sync_source(session, source, artists, now)
        for artist_id, status in source_statuses.items():
            statuses[artist_id].add(status)
        created += pass_counts[0]
        updated += pass_counts[1]
        removed += pass_counts[2]

    combined = [
        next(status for status in _STATUS_PRIORITY if status in outcomes)
        for outcomes in statuses.values()
    ]

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
        artists_synced=combined.count("synced"),
        artists_skipped=combined.count("skipped"),
        artists_unknown=combined.count("unknown"),
        artists_failed=combined.count("failed"),
        events_created=created,
        events_updated=updated,
        events_removed=removed,
        events_total=total,
    )


async def _sync_source(
    session: AsyncSession, source: _Source, artists: Sequence[Artist], now: datetime
) -> tuple[dict[uuid.UUID, str], tuple[int, int, int]]:
    result = await session.execute(
        select(source.identity_model).where(
            source.identity_model.artist_id.in_([artist.id for artist in artists])
        )
    )
    identities = {identity.artist_id: identity for identity in result.scalars()}

    statuses: dict[uuid.UUID, str] = {}
    to_fetch: list[Artist] = []
    for artist in artists:
        identity = identities.get(artist.id)
        ttl = EVENT_SYNC_TTL if identity and identity.external_id else UNRESOLVED_RETRY
        if identity and identity.last_synced_at and now - identity.last_synced_at < ttl:
            statuses[artist.id] = "skipped"
        else:
            to_fetch.append(artist)

    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    outcomes = await asyncio.gather(
        *(
            _fetch_artist_events(
                source,
                identities[artist.id].name if artist.id in identities else artist.name,
                identities[artist.id].external_id if artist.id in identities else None,
                semaphore,
            )
            for artist in to_fetch
        )
    )

    created = updated = removed = 0
    for artist, (status, external_id, events) in zip(to_fetch, outcomes, strict=True):
        statuses[artist.id] = status
        if status == "failed":
            # Leave last_synced_at untouched so the next sync retries.
            continue
        identity = identities.get(artist.id) or await _get_or_create_identity(
            session, source, artist
        )
        if identity.external_id is None:
            identity.external_id = external_id
        identity.last_synced_at = now

        artist_created, artist_updated = await _upsert_artist_events(
            session, source, artist.id, events
        )
        created += artist_created
        updated += artist_updated
        if status == "synced":
            # Only delete after a successful sync
            removed += await _prune_events(session, source, artist.id, events, now)
    return statuses, (created, updated, removed)


async def _fetch_artist_events(
    source: _Source, name: str, external_id: str | None, semaphore: asyncio.Semaphore
) -> tuple[str, str | None, list[SourceEventData]]:
    async with semaphore:
        try:
            if external_id is None:
                external_id = await source.resolve(name)
            if external_id is None:
                return "unknown", None, []
            return "synced", external_id, await source.fetch(external_id)
        except source.errors:
            return "failed", external_id, []


async def _get_or_create_identity(
    session: AsyncSession, source: _Source, artist: Artist
) -> TicketmasterArtist | RaArtist:
    """Insert-then-select so a concurrent sync creating the same identity
    row is adopted instead of raising on the unique constraint."""
    await session.execute(
        pg_insert(source.identity_model)
        .values(artist_id=artist.id, name=artist.name)
        .on_conflict_do_nothing(index_elements=[source.identity_model.artist_id])
    )
    result = await session.execute(
        select(source.identity_model).where(source.identity_model.artist_id == artist.id)
    )
    return result.scalar_one()


def _apply_event_data(event: Event, data: SourceEventData) -> None:
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
    session: AsyncSession, source: _Source, artist_id: uuid.UUID, events: list[SourceEventData]
) -> tuple[int, int]:
    # Display-preference order: among several records of one show, the first
    # processed owns the event's fields - a timed record beats a timeless one
    # (a "2-day pass" dated at midnight), the primary listing beats its
    # ticket-product variants, and ties break by id.
    events = sorted(
        {data.external_id: data for data in events}.values(),
        key=lambda data: (not data.time_known, -data.richness, data.external_id),
    )
    if not events:
        return 0, 0
    model = source.event_model

    result = await session.execute(
        select(model, Event)
        .join(Event, model.event_id == Event.id)
        .where(model.external_id.in_([data.external_id for data in events]))
    )
    existing = {row.external_id: (row, event) for row, event in result.all()}

    new_events = [data for data in events if data.external_id not in existing]
    candidates, sourced_here = await _adoption_candidates(session, source, artist_id, new_events)
    outranked = await _outranked_event_ids(
        session,
        source,
        [event.id for _, event in existing.values()]
        + [event.id for events_on_date in candidates.values() for event in events_on_date],
    )

    created = updated = 0
    event_ids: list[uuid.UUID] = []
    owned: set[uuid.UUID] = set()
    new_rows: list[tuple[Event, SourceEventData, bool]] = []
    for data in events:
        pair = existing.get(data.external_id)
        if pair is not None:
            row, event = pair
            row.url = data.url
            row.lineup = data.lineup
            updated += 1
        else:
            adopted = _adopt(data, candidates, sourced_here)
            if adopted is not None:
                event = adopted
                updated += 1
            else:
                event = Event(id=uuid.uuid7())
                session.add(event)
                candidates.setdefault(data.starts_at.date(), []).append(event)
                created += 1
            new_rows.append((event, data, adopted is None))
        sourced_here.add(event.id)
        if event.id not in outranked and event.id not in owned:
            _apply_event_data(event, data)
            owned.add(event.id)
        event_ids.append(event.id)

    # Flush new events before inserting source rows (dependency order)
    await session.flush()
    if new_rows:
        stmt = pg_insert(model).values(
            [
                {
                    "event_id": event.id,
                    "external_id": data.external_id,
                    "url": data.url,
                    "lineup": data.lineup,
                }
                for event, data, _ in new_rows
            ]
        )
        # A concurrent sync may have created the same source row between our
        # select and this insert; on conflict, adopt its canonical event and
        # drop any duplicate event we just made.
        stmt = stmt.on_conflict_do_update(
            index_elements=[model.external_id],
            set_={"url": stmt.excluded.url, "lineup": stmt.excluded.lineup},
        ).returning(model.external_id, model.event_id)
        result = await session.execute(stmt)
        ours_by_external = {data.external_id: (event, fresh) for event, data, fresh in new_rows}
        for external_id, event_id in result.all():
            ours, fresh = ours_by_external[external_id]
            if event_id != ours.id:
                event_ids[event_ids.index(ours.id)] = event_id
                if fresh:
                    await session.delete(ours)
                    created -= 1
                    updated += 1

    await session.execute(
        pg_insert(EventArtist)
        .values(
            [
                {"event_id": event_id, "artist_id": artist_id}
                for event_id in dict.fromkeys(event_ids)
            ]
        )
        .on_conflict_do_nothing()
    )
    return created, updated


async def _adoption_candidates(
    session: AsyncSession,
    source: _Source,
    artist_id: uuid.UUID,
    new_events: list[SourceEventData],
) -> tuple[dict[date, list[Event]], set[uuid.UUID]]:
    """The artist's stored events around the incoming dates, grouped by
    calendar date, plus which of them already carry a row from this source."""
    if not new_events:
        return {}, set()
    earliest = min(data.starts_at for data in new_events) - timedelta(days=1)
    result = await session.execute(
        select(Event)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .where(EventArtist.artist_id == artist_id, Event.starts_at >= earliest)
    )
    stored = list(result.scalars())
    if not stored:
        return {}, set()
    candidates: dict[date, list[Event]] = {}
    for event in stored:
        candidates.setdefault(event.starts_at.date(), []).append(event)
    result = await session.execute(
        select(source.event_model.event_id).where(
            source.event_model.event_id.in_([event.id for event in stored])
        )
    )
    return candidates, set(result.scalars())


def _adopt(
    data: SourceEventData, candidates: dict[date, list[Event]], sourced_here: set[uuid.UUID]
) -> Event | None:
    """The stored event this source record is another view of: same calendar
    date (candidates are already scoped to the artist) and venues coinciding
    by SAME_VENUE_KM proximity or by name. Across sources the nearest start
    time wins so double-show nights pair up correctly. An event this source
    already describes is only the same show when the start times agree (or
    the record has none): Ticketmaster lists one show once per ticket product
    - suites, passes, tiers - at the same time, whereas two same-night records
    at different times are two shows (early/late sets, common on RA)."""
    best: Event | None = None
    best_delta: timedelta | None = None
    for event in candidates.get(data.starts_at.date(), ()):
        if event.id in sourced_here and data.time_known and event.starts_at != data.starts_at:
            continue
        same_place = _haversine_km(
            event.venue_latitude,
            event.venue_longitude,
            data.venue_latitude,
            data.venue_longitude,
        ) <= SAME_VENUE_KM or lookup_key(event.venue_name) == lookup_key(data.venue_name)
        if not same_place:
            continue
        delta = abs(event.starts_at - data.starts_at)
        if best_delta is None or delta < best_delta:
            best, best_delta = event, delta
    return best


async def _outranked_event_ids(
    session: AsyncSession, source: _Source, event_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """Events whose display fields belong to a higher-precedence source."""
    ids = list(dict.fromkeys(event_ids))
    outranked: set[uuid.UUID] = set()
    if not ids:
        return outranked
    for model in source.outranked_by:
        result = await session.execute(select(model.event_id).where(model.event_id.in_(ids)))
        outranked.update(result.scalars())
    return outranked


async def _prune_events(
    session: AsyncSession,
    source: _Source,
    artist_id: uuid.UUID,
    events: list[SourceEventData],
    now: datetime,
) -> int:
    """Delete this source's rows for the artist's future events that
    disappeared from the feed, then delete events left with no source rows at
    all; an event shared with another source survives on its other row."""
    model = source.event_model
    to_prune = (
        select(model.id, model.event_id)
        .join(Event, model.event_id == Event.id)
        .join(EventArtist, EventArtist.event_id == Event.id)
        .where(EventArtist.artist_id == artist_id, Event.starts_at > now)
    )
    if events:
        to_prune = to_prune.where(model.external_id.notin_([data.external_id for data in events]))
    result = await session.execute(to_prune)
    rows = result.all()
    if not rows:
        return 0
    event_ids = list({event_id for _, event_id in rows})
    await session.execute(delete(model).where(model.id.in_([source_id for source_id, _ in rows])))
    still_sourced: set[uuid.UUID] = set()
    for other in SOURCE_EVENT_MODELS:
        result = await session.execute(select(other.event_id).where(other.event_id.in_(event_ids)))
        still_sourced.update(result.scalars())
    orphaned = [event_id for event_id in event_ids if event_id not in still_sourced]
    if orphaned:
        await session.execute(delete(Event).where(Event.id.in_(orphaned)))
    return len(orphaned)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    central_angle = 2 * math.asin(
        math.sqrt(
            math.sin((lat2 - lat1) / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
        )
    )
    return 6371.0 * central_angle
