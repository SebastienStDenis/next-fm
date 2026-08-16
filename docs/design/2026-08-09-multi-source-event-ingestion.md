# Multi-source event ingestion: Ticketmaster + Resident Advisor

*Written 2026-08-09 by Claude (Fable 5).*

Replaces Bandsintown as the concert source with two sources fetched side by
side: the Ticketmaster Discovery API for the mainstream circuit and Resident
Advisor for the club/electronic scene Bandsintown barely carried. Supersedes
the source-specific parts of `docs/design/2026-07-06-event-ingestion-plan.md`;
everything structural in that doc (artist-first flow, canonical `events` +
per-source tables, matching as a query, freshness on the identity row) carries
over unchanged and is not restated here.

## Why these sources

Bandsintown aggregates ticketing partners (Ticketmaster, AXS, Eventbrite, See
Tickets) plus promoter/artist submissions; club shows sold on DICE or listed
on RA rarely appear. Of the candidate replacements, only two were both
pull-able and worth pulling:

- **Ticketmaster Discovery API**: official, free key, artist-queryable
  (attractions), 5000 requests/day / 5 req/s on the free tier.
- **RA**: no official API, but the GraphQL endpoint behind ra.co serves
  artist search and per-artist upcoming events. It is the de facto global
  database for electronic music.

Dead ends, checked 2026-08: Eventbrite killed public event search in 2020;
AXS and See Tickets have no discovery API; Songkick stopped issuing keys;
DICE's only API is partner-scoped; Edmtrain's terms forbid combining with
other sources. RA's own club listings cover most of what DICE sells anyway.

## Both sources stay artist-first

The Concerts tab lets a user search **any** city, not just tracked ones, and
that works only because ingestion is artist-first: an artist's events exist
globally once fetched. An early sketch had RA ingested per *area* (the shape
every public RA scraper uses), scoped to tracked cities - it would have
silently missed club shows in ad-hoc searched cities and was dropped.

Live probes against `https://ra.co/graphql` (2026-08-09) confirmed
artist-first works, and the exact queries shipped in
`backend/app/clients/ra.py` were verified against production responses:

- `search(searchTerm, indices: [ARTIST])` resolves names to RA artist ids.
- `artist(id) { events(limit, type: LATEST) }` returns exactly the artist's
  upcoming events, worldwide, with title, start time, full lineup, venue
  name/address, venue coordinates, and area (city) + country. Introspection
  is enabled; `LATEST` is what RA's own artist pages use.
- Data quirks: TBA venues carry (0, 0) coordinates (dropped at parse, the
  same rule as missing coordinates); some venues have coarse city-centroid
  coordinates (fine for 50 km matching).

Ticketmaster is natively artist-first: resolve the artist to an *attraction*
(`/attractions?keyword=`), then `/events?attractionId=` for upcoming dates.

## Identity resolution

Each source gets an identity table mirroring the old `bandsintown_artists`
(`ticketmaster_artists`, `ra_artists`: `artist_id` unique FK, lookup `name`,
nullable `external_id`, `last_synced_at`). Resolution is deliberately strict:
a candidate is accepted only when its name matches exactly under `lookup_key`
(casefold + whitespace collapse, `backend/app/clients/source_events.py`) - a
near-miss is more likely a tribute act than a spelling variant, and a wrong
match puts the wrong shows in someone's playlist. No-match artists are stamped
`last_synced_at` anyway, so they re-probe once per TTL instead of every sync.

## Cross-source duplicates

The general "same show on two sources" problem is deliberately narrowed: the
product only surfaces events through artist matches, so a duplicate only hurts
when the *same canonical artist* carries the same show from both sources. That
reduces dedup to a cheap rule applied at ingest, when a source record has no
existing row (`_adopt` in `backend/app/sync/event_sync.py`):

> Among the artist's stored events on the same calendar date, adopt the one
> whose venue coincides - within 1 km, or by venue-name equality under
> `lookup_key` - picking the nearest start time when several match.

Guards, all load-bearing:

- **Same-source records merge only when the start times agree** (or the
  incoming record has no time). Two same-night records of one source at
  different times are two shows - early/late sets, common for club artists
  on RA - and the source is the authority. Same-time records *are* one
  show: Ticketmaster lists a show once per ticket product (live-verified
  2026-08-09: Metallica at Sphere is "Life Burns Faster" + "Suite
  Reservation" + a timeless "2-Day Ticket"; Creamfields Saturday is four
  tier/payment-plan records; Charli xcx's arena dates pair with "ANGEL
  TICKETS" packages), so 63 Metallica records are 26 shows.
- **Cross-source, the nearest start time wins**, unconstrained: RA and
  Ticketmaster rarely agree to the minute on a club night.
- **Wall-clock convention makes dates comparable.** Both clients label
  venue-local time as UTC (the repo-wide convention), so "same calendar date"
  never trips over timezones. A record without a time is dated at midnight
  with `time_known` false.

Which record of a merged show owns its fields is decided by processing a
source's records in display-preference order and letting the first one
write: timed before timeless, then the **richest** record, then id. Richness
is a structural score Ticketmaster records carry (`SourceEventData.richness`:
presale window + seat map + add-on products present, 0-3) - the primary
listing is the fully configured one, ticket-product variants are thin
records. Verified across the probes above: the main listing outranks its
suite/package/gallery siblings every time, and tied festival tiers read
identically anyway. No record name is ever parsed.

A merged event carries one source row per source (`ticketmaster_events`,
`ra_events` - same shape as the old `bandsintown_events`), each keeping its
own `external_id` so per-source re-syncs keep working. This is the merge the
original event-ingestion doc sketched for Bandsintown's cross-feed duplicates,
promoted to the primary mechanism.

## Display precedence

A shared event's display fields (title, venue, city, dates) are written by
**Ticketmaster over RA**, deterministically and re-applied every sync: a
source only applies fields to events with no higher-precedence source row.
The ticket URL follows the same order (`ticket_url` in
`backend/app/sync/matching.py`); showing both sources' links is a possible
follow-up, deliberately not done now to keep the card layout unchanged. There
is no blending - whichever source owns the event supplies all of its fields
verbatim, preserving the store-verbatim/render-verbatim invariant of
`docs/design/2026-07-18-concert-venues.md` (whose card-title tautology rule
stays in force unchanged).

## Deletion

Pruning moves from event-level to source-row-level: a show vanishing from one
source's feed deletes that source's row, and the canonical event dies only
with its last source row. Cancelled Ticketmaster events are filtered at parse
(`dates.status.code == "cancelled"`), which reads as vanished - consistent
with the "vanish = cancellation" semantics the Bandsintown plan set.

## Sync mechanics

`sync_user_events` runs the two source passes sequentially (Ticketmaster
first, so its fields win on first contact), each pass being the familiar
freshness-gated per-artist flow with the same 24 h TTL. Client-side
throttles: Ticketmaster 5 req/s (under the documented limit), RA 1 req/s -
unofficial endpoint, keep traffic unmistakably polite. A cold user (every
artist unresolved) costs up to two RA requests per artist at 1 req/s, which
is why the events activity timeout was raised to 30 minutes in
`backend/app/sync/sync_workflow.py`; steady-state syncs touch only stale
artists and stay fast. The step summary aggregates per-artist outcomes across
sources: synced anywhere counts synced, failed anywhere (and nowhere synced)
counts failed, unknown means unknown on every source that was asked.

## Cutover

Hard cutover, one migration (`1a7dd69c3a31`): create the four new tables,
drop the two Bandsintown tables, and `DELETE FROM events` - Bandsintown-era
events have no source rows in the new tables and the new prune only reaches
events through source rows, so they would otherwise linger forever.
`playlist_tracks.event_id` is `SET NULL` on delete, and the sync order
(artists → suggestions → events → playlists) refills events before playlists
recompute, so the visible cost is one full playlist rewrite per user on the
first post-cutover sync.

## Operational profile

`TICKETMASTER_API_KEY` is the one new secret (free, from
developer.ticketmaster.com); RA needs no key. The failure modes and runbook -
Ticketmaster quota exhaustion, RA schema drift or Cloudflare blocking - live
in `docs/operations.md`. The standing risks, accepted knowingly:

- **RA is an unversioned, unofficial contract** (the same posture as the old
  Bandsintown `V3.1/` path). It can break or block at any time; the RA pass
  failing leaves Ticketmaster coverage intact and keeps serving previously
  synced RA events until they age out.
- **Ticketmaster's free quota** bounds daily artist volume at roughly
  5000 fetches; the identity cache and TTL keep steady state well under it,
  and batching attraction ids per call is the documented escape hatch.
