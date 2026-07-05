# Artist ingestion design

How artists enter the system from external taste sources (Last.fm first), how they are
represented so future sources (Spotify, Apple Music, ...) fit without rework, and how
per-user interest in an artist is modeled with explicit reasons.

## What Last.fm actually provides

The whole API works with just an API key on any public username; no user auth is needed.
Two constraints shape the design:

1. **There is no artist-follow relationship on Last.fm.** Following is user-to-user only.
   Every artist-level signal is scrobble-derived:
   - `user.getTopArtists` - ranked artists with playcounts, filterable by period
     (`7day`, `1month`, `3month`, `6month`, `12month`, `overall`). The workhorse. Each
     artist has `name`, `playcount`, `rank`, `url`, and sometimes `mbid`.
   - `library.getArtists` - the entire artist library with playcounts (no period filter,
     can be thousands of pages for heavy users).
   - `user.getLovedTracks` - loved *tracks* with artist attached; aggregate by artist
     client-side to get "loved N tracks by this artist".
   - `user.getRecentTracks` - raw scrobbles with timestamps (max 200/page). A privacy
     setting ("hide recent listening") blocks this endpoint with a misleading
     "login required" error (code 17); top artists appear unaffected.
   - `artist.getInfo` / `artist.getSimilar` - per-artist enrichment: tags (de facto
     genres), bio, listener counts, and 0-1 similarity scores for discovery.

2. **Last.fm provides no bridge to other services.** No Spotify or Apple Music IDs, no
   external links. MBIDs (MusicBrainz IDs) are frequently empty, especially for the
   long-tail acts a concert product cares about. Artist images from the API have been a
   placeholder since ~2019; do not plan on Last.fm for artwork.

Operational constraints: ~5 req/s rate limit (community figure, not published),
attribution required, ToS allows non-commercial use only, and stored Last.fm data is
capped at 100 MB without written consent. The API is stable but de facto unmaintained.

## Decision: we own the canonical artist registry

External identity services exist - MusicBrainz is free and open, and its artist records
carry URL relationships to Spotify, Apple Music, Bandcamp, and YouTube Music - but we do
not make one our backbone:

- Coverage is editor-driven: good for established artists, patchy for exactly the small
  touring acts this product cares about.
- Last.fm can't reliably hand us an MBID anyway, so reaching MusicBrainz requires name
  matching - at which point we could name-match directly into Spotify.
- 1 req/s rate limit, and it would couple our core identity model to a third party.

Instead, our `artists` table is the canonical registry, and each external service is an
identity claim attached to it. MusicBrainz is used opportunistically (when an MBID
exists, its `url-rels` can validate or supply a Spotify ID). Spotify search-by-name is
the primary cross-service resolver later - we already hold Spotify credentials for the
playlist bot, and its rate limits are far more generous.

## Schema

Mirrors the existing `LastfmAccount` + `LastfmConnection` pattern: a source-specific
record, linked to a canonical entity.

```
artists                      -- canonical, thin
  id             uuidv7 PK
  name           str          (display name, copied from best source)
  created_at / updated_at

lastfm_artists               -- Last.fm's view of an artist
  id             uuidv7 PK
  artist_id      FK -> artists.id (index)
  name           str          (Last.fm keys artists by name)
  url            str
  mbid           str | None   (opportunistic, often empty)
  listeners      int | None   (global stats from artist.getInfo, filled by enrichment)
  playcount      int | None
  tags           JSONB | None (genres, filled by enrichment)
  last_synced_at
  created_at / updated_at
  unique index on lower(name)
```

A future source is a new typed table (`spotify_artists`, ...) FK-ing to the same
`artists.id` - the same migration-per-source cost already paid for accounts, keeping
real column types. A generic `artist_identities(source, external_key, payload)` table is
the alternative shape; revisit only if the source count grows past a handful.

### Deduping: deferred, but structurally solved

On ingest, every new Last.fm artist creates its own canonical `artists` row (1:1 for
now). Because everything else - interests, future Spotify identities, future Bandsintown
matches - references `artists.id` and never a source row, a future merge is mechanical:
repoint the source rows and interest rows from the duplicate to the survivor, delete the
duplicate. Entity resolution is not needed now; every FK pointing at the canonical layer
is what keeps it cheap later.

## User-artist interests: one row per (user, artist, reason)

The reason is a first-class row, not an attribute, so multiple independent reasons per
(user, artist) coexist and sync independently - a Last.fm re-sync upserts its own kinds
without touching what an internal matcher wrote. The playlist-building layer aggregates
rows into a score later, and the UI can always answer "why is this artist in my
playlist?".

```
user_artist_interests
  id             uuidv7 PK
  user_id        FK -> users.id (cascade)
  artist_id      FK -> artists.id (cascade)
  kind           str           -- "lastfm_top_artist", "lastfm_loved_tracks", "genre_overlap", ...
  source         str           -- "lastfm", "internal", later "spotify"
  evidence       JSONB         -- kind-specific detail
  created_at / updated_at
  unique (user_id, artist_id, kind)
```

Example rows:

| kind                  | source   | evidence                                          |
| --------------------- | -------- | ------------------------------------------------- |
| `lastfm_top_artist`   | lastfm   | `{"rank": 12, "playcount": 843, "period": "12month"}` |
| `lastfm_loved_tracks` | lastfm   | `{"track_count": 10}`                             |
| `genre_overlap`       | internal | `{"genres": ["shoegaze"], "score": 0.7}`          |

Design notes:

- `kind` is a plain string with app-level constants, not a Postgres enum, so adding
  reasons never needs a migration.
- The typed columns (`kind`, `source`, timestamps) are everything queried and filtered
  on; JSONB only holds display/debug detail. Resist querying into `evidence`.
- A `weight` column (normalized strength for ranking) is deliberately omitted until the
  scoring/playlist layer exists to consume it.
- Interests point at the **canonical** artist, with `source` as a column, rather than at
  `lastfm_artists`. That is what makes relations survive merges and lets an internal
  matcher create interests for artists that arrived via any source.

### Sync semantics

Each sync of a given (user, source, kind) scope upserts current rows and deletes rows
that vanished from the source (the artist fell out of their top list). `created_at`
survives upserts and therefore means "first seen"; `updated_at` means "last confirmed".
Caveat: SQLAlchemy's `onupdate` only fires when an UPDATE actually changes a column, so
the sync should explicitly touch `updated_at` on unchanged rows if "last confirmed by a
sync" needs to be reliable. Since presence in the table already means "current", this
only matters if staleness monitoring is added.

## Phases

**Phase 1 - schema + client.** One migration for the three tables. Extend
`LastfmClient` with `get_top_artists(username, period, limit, page)` and
`get_loved_tracks(username, ...)`, same style as `get_user_info`.

**Phase 2 - sync endpoint.** `POST /users/{id}/lastfm/artists/sync` plus
`GET /users/{id}/artists` to read back interests with reasons. The sync fetches top
artists for `12month` (the most relevant horizon for "who's touring soon"; 200-500
artists is one or two calls), aggregates loved tracks, and upserts
`lastfm_artists` -> `artists` -> `user_artist_interests`. Reuses the existing
refresh-endpoint pattern; no background infrastructure needed yet.

**Phase 3 - background refresh.** A scheduled task re-syncing stale accounts (ordered
by `last_synced_at`), throttled well under 5 req/s.

**Phase 4 - enrichment + cross-service.** `artist.getInfo` for tags, `artist.getSimilar`
for discovery interests (`kind="lastfm_similar_artist"`, evidence carrying the match
score and the seed artist). Spotify resolution lands here as a `spotify_artists` table
populated by search-by-name, with MusicBrainz as validator when an MBID exists.

## To verify empirically (undocumented)

- The real maximum `limit` for `user.getTopArtists` (folklore says ~1000).
- Exactly which endpoints the "hide recent listening" privacy setting blocks
  (`getRecentTracks` confirmed; handle error 17 gracefully during sync regardless).
- Whether `artist.getInfo` lookup by `mbid` currently works reliably; prefer lookup by
  name with `autocorrect=1`.
