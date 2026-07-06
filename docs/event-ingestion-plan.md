# Event ingestion design

How concert events enter the system, how they attach to the canonical artist registry
(see `docs/artist-ingestion-plan.md`), and how a user's upcoming shows are computed from
data we already hold. Scope for now: suggest events only for artists the user is already
linked to; suggested artists are covered at the end because they change nothing in this
pipeline.

> **Status: Phases 0-2 done.** Bandsintown access is verified (app_id in `.env` as
> `BANDSINTOWN_API_KEY`) and the schema, client, and sync + read endpoints are
> implemented, with a demo Concerts panel on the user page. Two deviations from the
> sketch below: events store the source's full `country` name rather than a
> `country_code`, and Bandsintown's venue-local datetimes (no offset) are stored as
> UTC, which is close enough for date-granular matching. Phases 3-4 remain.

## Decision: artist-first ingestion, not city-first

Two possible flow directions:

- **City-first**: ingest every upcoming event in each city where we have users, then
  match each user's artists against the local inventory.
- **Artist-first**: take the union of distinct artists referenced by any user's
  interests, fetch each artist's upcoming dates, then match per user with a query.

Artist-first wins on structure, independent of what any API offers:

- **The product promise is artist-shaped.** "Artists you'd like playing near you", not
  "everything happening in town". City-first ingests every event in every user city and
  90%+ are by artists nobody tracks - dead weight fetched, stored, and re-synced
  forever. Artist-first makes every stored event relevant to at least one user by
  construction.
- **Artist data is globally shareable; city data is only locally shareable.** One fetch
  of an artist's tour dates serves every user in every city who likes that artist. City
  inventory only serves that city.
- **Name matching lands on the cheaper side.** Artist-first resolves each registry
  artist to the source once, cached on an identity row. City-first must name-match every
  artist on every event in every city against the registry, continuously, with most
  lookups missing.
- **It extends cleanly to discovery.** Suggested artists arrive as interest rows via
  similarity *before* events enter the picture, then their events are fetched like any
  other interest artist. Same pipeline, zero rework. City-first would only be needed for
  a different discovery mode ("score everything in town against my taste"), which is a
  browse feature, not the playlist feature.

The honest cost: per-artist fetches are mostly empty - the long tail of a 500-artist
taste profile is not touring - so we make many small calls for few events. Fine at this
scale, and bounded by per-artist freshness caching.

Bandsintown's public API happens to be shaped exactly this way (artist -> upcoming
events, no city-wide endpoint), so the structurally preferred flow and the intended
source agree.

## Schema

Same two-layer pattern as artists: a thin canonical entity, plus a typed table per
source holding that source's view. The split earns less for events than for artists -
events expire in weeks, so a cross-source duplicate is a short-lived annoyance rather
than a permanent identity problem - but the cost is one thin table in a pattern already
paid for, and downstream consumers (playlist entries, "why is this song here" UI) get a
stable canonical id to FK.

```
events                       -- canonical
  id             uuidv7 PK
  title          str
  venue_name     str
  venue_latitude   float
  venue_longitude  float
  city_name      str          (raw from source; not FK'd to cities)
  region         str | None
  country_code   str | None
  starts_at      timestamptz  (index)
  created_at / updated_at

event_artists                -- lineup links, canonical on both sides
  event_id       FK -> events.id (cascade)
  artist_id      FK -> artists.id (cascade)
  unique (event_id, artist_id)

bandsintown_events           -- Bandsintown's view of an event
  id             uuidv7 PK
  event_id       FK -> events.id (cascade, index)
  external_id    str          (unique)
  url            str | None
  lineup         JSONB | None (raw artist names, unresolved)
  created_at / updated_at

bandsintown_artists          -- Bandsintown's identity claim on an artist
  id             uuidv7 PK
  artist_id      FK -> artists.id (cascade, index)
  name           str          (the name used for lookups)
  external_id    str | None   (Bandsintown's numeric id, from responses)
  last_synced_at timestamptz | None
  created_at / updated_at
```

Design notes:

- **`event_artists` is many-to-many out of necessity, not generality.** Real shows have
  lineups, and a single `events.artist_id` FK could not represent a show matched to
  more than one interest artist without the second sync either failing or stealing the
  event from the first.
- **Bandsintown event records are per-artist** (observed in production data): each
  record carries a single owner `artist_id`, so co-billed artists each publish a
  *separate* record with its own `external_id` for the same physical show. Two
  consequences. First, upserting by `external_id` never dedupes across feeds - in the
  ingested data ~13% of events are cross-feed duplicates of the same show (festivals
  are the worst case), each linked to one artist, so a show shared by two interest
  artists currently appears once per artist. Second, openers still match today: an
  interest artist's own feed includes their support and festival slots.
- **Lineup resolution is deferred.** An event links only to the artist we fetched it
  through; the raw lineup names sit in JSONB on the source row for a later pass that
  resolves them against the registry. That pass is also where cross-feed duplicates
  merge: same venue coordinates + same start time (lineup overlap as confidence)
  collapses per-artist records into one canonical event carrying several
  `bandsintown_events` rows - each keeping its own `external_id` so per-artist
  re-syncs keep working - with `event_artists` links for every co-billed interest
  artist. Vanish-deletion then becomes per source row: a show dropping out of one
  artist's feed removes that artist's source row and link, and the canonical event
  only dies with its last source row.
- **`bandsintown_artists` mirrors `lastfm_artists`**: the source-specific identity claim
  anticipated by the artist plan. `last_synced_at` here means "when we last fetched this
  artist's events" and is what makes freshness global rather than per-user.
- **Events carry raw location, not a `cities` FK.** Venue coordinates come from the
  source; matching "near the user" is a distance filter (say 50 km, tunable) against the
  user's city coordinates from the `cities` table. Distance handles suburbs and metro
  areas that city-name equality would miss, and skips a fragile geocoding step at
  ingest.

## Matching is a query, not a table

There is **no user-event link table**. Once events are local and linked to canonical
artists, and interests are already local, a user's upcoming shows are one indexed join:

```
user_artist_interests (user)  ->  event_artists  ->  events
    where distance(event, user.city) < radius
      and events.starts_at > now()
```

No external calls at match time, so there is nothing to precompute. A materialized
`user_event_suggestions` table would need invalidation on every axis (event canceled,
user moved cities, artist fell out of their top list) - all bookkeeping for something a
query answers for free.

The thing that *should* be durable is the playlist itself: when the playlist layer
lands, its entry rows carry `artist_id` + `event_id` provenance. That is the audit
trail ("why is this song here" -> the show) and the diff base for incremental playlist
updates. A separate suggestions table would be redundant with it.

Note that in the current scope, event matching creates no rows anywhere: it never
writes to `user_artist_interests` (the interest already exists - that is what made the
artist matchable) and there is no event-side link to write. The join is always current.

## Freshness and sync semantics

"Process shows for user X" decomposes into two steps:

1. **Ensure freshness**: for each distinct artist in the user's interests, if
   `bandsintown_artists.last_synced_at` is within the TTL (say 24h), skip - the local
   copy is the truth. Only stale or never-synced artists trigger a fetch.
2. **Run the match join** against local data only.

Because `last_synced_at` lives on the artist identity row and nothing user-related,
freshness is shared globally: if user A likes an artist that user B's request refreshed
an hour ago, user A's request fetches nothing for that artist. Popular artists are
fetched roughly once per TTL window regardless of how many users share them; per-user
cost converges toward "artists nobody else has looked at lately".

This per-request freshness check is the V1 shape, matching the existing refresh-endpoint
pattern. Later, a background job re-syncing the stalest interest-referenced artists
(ordered by `last_synced_at`, the same Phase 3 shape as Last.fm account refresh) makes
user-facing requests pure reads. The schema is identical in both worlds.

Per-artist sync semantics mirror the artist plan's sync-scope rule: each sync of one
artist's events treats the response as the full truth for that artist's *future*
events -

- upsert by `external_id`;
- hard-delete any future-dated event of theirs that vanished from the source. That is a
  cancellation whether or not the source says so explicitly; if the source does send a
  canceled status, treat it the same way. Cascade cleans the source row and
  `event_artists` links (an event fetched via two artists is only deleted when it
  disappears from the still-linked artist's feed being synced; in practice a canceled
  show vanishes from every lineup member's feed).

**Passed events are filtered, not deleted**: the match query requires
`starts_at > now()`, so past events age out of relevance naturally. They cost nothing,
keep history for a possible "shows you were told about" view, and can be pruned by a
much-later job if volume ever justifies it.

## Suggested artists change nothing here

Discovery ("an artist you don't know is coming to town") is fully event-agnostic. The
suggestion engine (Last.fm `artist.getSimilar`, seeded from the user's existing interest
artists) does three things, none of which mention events:

1. Resolve each similar artist into the registry via the existing ingestion path -
   upsert `lastfm_artists` by `name_key`, creating a canonical `artists` row only when
   genuinely new. Many suggestions already exist because another user listens to them.
2. Write an interest row: `kind="lastfm_similar_artist"`, evidence carrying the seed
   artist and similarity score.
3. Done.

The event pipeline picks them up for free, precisely because it is defined as "fetch
events for every distinct artist referenced by any interest row" - it never asks *why*
an interest exists, and no branch anywhere says suggested vs direct. The distinction
surfaces only downstream, deliberately:

- **Playlist layer** weights or caps by `kind` (e.g. top 5 tracks for artists the user
  demonstrably listens to, top 2 for a discovery suggestion, or a bounded share of the
  playlist for suggestions).
- **UI** renders "because you listen to X" straight from the interest row's evidence.
- **Sync ownership**: the similarity engine upserts and deletes only its own `kind`, so
  a Last.fm top-artists re-sync and a suggestion refresh never clobber each other.

The one real design knob is **suggestion volume**: interests drive event fetching, so
every suggestion interest row is a standing commitment to keep that artist's tour dates
fresh. Naively taking top-10 similar artists for each of a user's 300 interest artists
mints ~3000 speculative artists per user and the event sync workload drowns in them.
Volume control belongs at suggestion-creation time, not in the event pipeline: seed
similarity only from the user's top-N artists, keep only matches above a similarity
threshold, aggregate when the same artist is similar to several seeds (a stronger
signal that also collapses rows), and cap suggestion interests per user at ~50-100,
replacing the weakest on refresh. Bounded interests keep everything downstream bounded
automatically.

## End state

The full pipeline this design slots into: interests (exists) -> events per
interest-artist (this plan) -> match join per user -> top-N tracks per matched artist ->
playlist diff. Track selection is a Spotify-layer concern; the only contract this
design owes it is "current (artist, event) pairs for a user", which the join provides.

## Phases

**Phase 0 - verify Bandsintown access.** Confirm API availability and terms for this
use case (app_id acquisition, rate limits, allowed usage). Everything below is TBD on
this. If unavailable, evaluate Ticketmaster Discovery and revisit the flow-direction
tradeoff for a city-shaped source.

**Phase 1 - schema + client.** One migration for the four tables. A
`BandsintownClient` with `get_artist_events(name)`, same style as `LastfmClient`,
injected via a dependency.

**Phase 2 - sync + read endpoints.** `POST /users/{id}/events/sync` (freshness-gated
per-artist fetch over the user's interest artists) plus `GET /users/{id}/events`
returning the match join with the artists that caused each match. Reuses the
refresh-endpoint pattern; no background infrastructure yet.

**Phase 3 - background refresh.** A scheduled task re-syncing the stalest
interest-referenced artists, removing the freshness check from the request path.

**Phase 4 - suggested artists.** The similarity engine writes capped
`lastfm_similar_artist` interests; this pipeline picks them up unchanged.
