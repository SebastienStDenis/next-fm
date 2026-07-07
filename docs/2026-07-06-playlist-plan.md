# Playlist generation design

*Written 2026-07-06 by Claude (Fable 5).*

How a user's city-matched shows become one public Spotify playlist, maintained by an
app-owned bot account. This is the layer the event plan (`docs/2026-07-06-event-ingestion-plan.md`)
owes its output to: it consumes "current (artist, event) pairs for a user" and produces
a synced tracklist with provenance.

> **Status: designed against the July 2026 Spotify API.** The development-mode
> constraints below were verified against Spotify's official changelog and blog, but
> Spotify has tightened developer access three times since late 2024 and will again.
> Phase 0 re-verifies everything empirically with a real app registration before any
> schema lands.

## What the Spotify API actually allows (July 2026)

Spotify splits apps into development mode and extended quota mode. Extended mode now
requires a legally registered business with an active service and 250k+ monthly active
users, so this project lives in development mode permanently. What that means for a
Client ID created today:

- **Available**: playlist create (`POST /v1/me/playlists`), add/remove/replace items
  (`/v1/playlists/{id}/items`, max 100 URIs per request), update name/description,
  search (`GET /v1/search`, `limit` capped at 10), single-entity lookups
  (`GET /v1/artists/{id}`, `/v1/tracks/{id}`).
- **Removed**: `GET /v1/artists/{id}/top-tracks` (gone for Client IDs created after
  Feb 11, 2026, no replacement), batch multi-ID fetches (`/v1/artists?ids=`), and the
  `popularity`/`followers` fields on artist and track objects.
- **Constraints**: max 5 authorized users per app (we need exactly one - the bot); the
  app owner must hold Spotify Premium; one development-mode Client ID per developer;
  refresh tokens expire after 6 months (enforced from July 20, 2026); rate limits are
  a rolling 30-second window, unpublished but low - cache aggressively; development
  mode is for non-commercial use.

Two of these shape the whole design. The 5-user allowlist is why the bot-account
architecture works at all: users never authenticate with Spotify, only the bot does, so
the allowlist never fills. And the top-tracks removal means Spotify cannot tell us
*which* songs are an artist's best - only whether a given song exists and is playable.

## Decision: track selection from Last.fm, playability from Spotify

With `top-tracks` gone, the two candidate sources split cleanly by what they still
offer:

- **Last.fm `artist.getTopTracks`** returns an artist's tracks ranked by global
  playcount - exactly the "which songs" signal - but with no Spotify identifiers of any
  kind (name, playcount, an often-missing MBID; no external links).
- **Spotify search** (`type=track`, `q=track:"<title>" artist:"<name>"`) resolves a
  known title to a playable URI, but with `popularity` stripped and `limit` capped at
  10 it cannot rank an artist's catalog by itself.

So the pipeline uses both, each for what it is good at: Last.fm decides the top N
tracks, one Spotify search per track turns each into a URI, and unmatched tracks are
skipped (the artist just contributes fewer songs). Per playlist-relevant artist that is
1 Last.fm call + ~N Spotify searches, cached for weeks - top tracks are stable.

This only runs for artists that actually match an upcoming show near some user (the
event-plan join), not the whole interest graph, so the call volume is small by
construction.

### Resolving artists to Spotify IDs

Track search alone can hit the wrong artist on ambiguous names, so each canonical
artist is resolved to a Spotify artist ID once, stored as an identity claim
(`spotify_artists`, the table the artist plan already anticipated):

1. **MBID path (when Last.fm gave one)**: MusicBrainz `url-rels` frequently include the
   artist's `open.spotify.com/artist/...` link - a deterministic mapping, 1 req/s limit,
   used opportunistically.
2. **Search path (the workhorse)**: `GET /v1/search?type=artist`, match by normalized
   name. Without `popularity`, confidence comes from exact-name match plus Spotify's
   own relevance ordering. Ambiguous results are stored with a low-confidence flag
   rather than guessed at; those artists simply don't contribute tracks until resolved.

Track searches then verify the returned track's artist ID against the resolved one,
which is what makes name collisions safe.

## Decision: playlists are reconciled, not mutated

The playlist is a first-class local entity, and sync is declarative: compute the
tracklist the playlist *should* have from local data, diff against what we last wrote,
push the difference. There is no "on new show, add songs" or "on cancellation, remove
songs" code path.

The alternative - incremental mutations driven by change events - needs a handler per
change type: show canceled, show passed, artist fell out of the user's top list, user
moved cities, track cache refreshed, someone edited the playlist by hand. Miss one and
the playlist is silently wrong forever. Reconciliation makes all of them the same code
path, is idempotent (a crashed sync just runs again), and is self-healing (drift from
manual edits on the Spotify side is corrected on the next sync). Removals fall out for
free: a passed show fails the `starts_at > now()` filter in the desired-state query, a
canceled show's event row was already deleted by event sync, and either way the songs
it justified vanish from the computed tracklist and the diff removes them.

This is the event plan's "matching is a query, not a table" principle extended one
layer up. The desired tracklist is a query. The durable record of what we last wrote
(`playlist_tracks`) exists for provenance and change reporting, not as a diff base:
since the write is a full replace, sync never needs to know what Spotify currently
holds.

### Desired-state computation

For a playlist of kind `city_shows`:

1. Run the event-plan match join: the user's interest artists with an event within
   radius of the playlist's target city (`city_id`, or `users.city_id` when null),
   `starts_at > now()`.
2. For each matched artist, take the top N cached tracks (N=5 at first; the
   suggestion plan later drops this to a uniform N=3, deliberately declining the
   per-kind weighting once anticipated here).
3. Order by soonest show per artist, then track rank, so the playlist reads as "what's
   coming up next". Dedupe URIs (a track can chart for two artists via collaborations).
4. Cap the playlist at 100 tracks, dropping lowest-rank tracks from furthest-out shows
   first. The cap keeps the playlist listenable and the whole tracklist within a
   single 100-URI replace request.

## Schema

Two identity/cache tables on the artist side, two playlist tables on the user side.

```
spotify_artists              -- Spotify's identity claim on a canonical artist
  id                  uuidv7 PK
  artist_id           FK -> artists.id (cascade, index)
  spotify_id          str (unique)
  name                str          (Spotify's display name)
  match_confidence    str          -- "exact", "fuzzy", "manual"; low-confidence rows
                                   -- don't contribute tracks
  top_tracks_synced_at  timestamptz | None
  created_at / updated_at

artist_top_tracks            -- cached "best songs" per canonical artist
  id                  uuidv7 PK
  artist_id           FK -> artists.id (cascade, index)
  rank                int          (from Last.fm playcount ordering)
  title               str
  spotify_track_id    str
  created_at / updated_at
  unique (artist_id, spotify_track_id)

playlists                    -- first-class, one-to-many from users
  id                  uuidv7 PK
  user_id             FK -> users.id (cascade, index)
  kind                str          -- "city_shows" for now
  city_id             FK -> cities.geonameid | None (set null)
                                   -- null = follow users.city_id; set = pinned
  name                str          -- desired title; sync pushes it to Spotify
  description         str | None
  spotify_playlist_id str | None (unique)  -- null until created remotely
  spotify_url         str | None
  snapshot_id         str | None   -- Spotify's version token from the last write
  last_synced_at      timestamptz | None
  created_at / updated_at
  unique (user_id, kind, city_id)   -- nulls not distinct

playlist_tracks              -- what we last wrote, with provenance
  id                  uuidv7 PK
  playlist_id         FK -> playlists.id (cascade, index)
  position            int
  spotify_track_id    str
  artist_id           FK -> artists.id | None (set null)  -- why this song is here
  event_id            FK -> events.id | None (set null)   -- the show that justified it
  created_at / updated_at
  unique (playlist_id, spotify_track_id)
```

Design notes:

- **`user_id` is one-to-many by construction**, with `kind` and target city as the
  axes of multiplicity: a future per-genre or per-weekend playlist is a new kind,
  another city is another row of the same kind. `unique (user_id, kind, city_id)`
  (nulls not distinct, a PG15+ option) keeps one playlist per target.
- **`city_id` pins a playlist to a city; null means "follow the user".** The default
  playlist has `city_id = null` and computes against `users.city_id` at sync time, so
  moving house re-targets it automatically - the right behavior for "my local shows",
  and it keeps a single source of truth for where the user lives. A pinned playlist
  ("shows in Tokyo" for a trip) carries its own city as an independent fact: the
  user's home changing never touches it, and it is created and deleted only by
  explicit user action, capped app-side at 3 city playlists per user to start (a
  product knob, not schema). Because event ingestion is artist-first and
  city-agnostic, an extra city costs nothing upstream - the artists' tour dates are
  already local, and each playlist just runs the match join around different
  coordinates.
- **`playlist_tracks` is the provenance IOU from the event plan**: `artist_id` +
  `event_id` answer "why is this song here" for the UI, and the rows are what sync
  reports its changes against. When a track is justified by several shows - or several
  artists, a collaboration charting for both - the row carries the soonest show and its
  artist; every sync rewrites provenance along with the tracklist, so it never goes
  stale.
- **Written state stands alone: rows point at facts, never at caches, and only the
  playlist sync may delete them.** No FK to `artist_top_tracks` - the cache is
  volatile (whole-set replacement on re-fetch, purged on re-resolution), while the
  record of what we wrote to Spotify must survive anything the cache does. For the
  same reason the provenance FKs are `SET NULL`, not cascade: event sync hard-deletes
  canceled shows, and a cascade here would silently delete the written-state row,
  leaving the record lying about what the last write contained. Under `SET NULL` the
  row survives with blank provenance until the next sync rewrites it.
- **Playlists are one layer, not two, unlike artists and events.** The two-layer
  pattern exists for ingested entities, where the same real-world thing arrives from
  several sources and duplicates must eventually merge. Playlists are the opposite: we
  own them and project them outward to a provider, so there is no cross-source identity
  problem to prepare for. If a second streaming target ever lands, the split happens
  then, mechanically: `playlists` keeps the intent (user, kind, name) and a per-provider
  table (`spotify_playlists`, ...) takes the external id, snapshot, and written-track
  rows. The stored tracklist stays provider-level in that world by nature - it is the
  record of what we last wrote to *that provider*, in that provider's track ids - while
  the canonical tracklist remains the desired-state query, never a stored row. The same
  move applies to `artist_top_tracks`: `rank` and `title` come from Last.fm and are
  provider-neutral - that is already the canonical ranked list - so a second provider
  adds its own track resolution beside `spotify_track_id` rather than replacing the
  table. Until then, Spotify stays concrete and explicitly named at the leaves
  (`spotify_artists`, `spotify_track_id`, the `spotify_*` playlist columns) rather than
  hidden behind generic wrappers: everything upstream - users, interests, artists,
  events, desired-state logic - never mentions Spotify, and an abstraction designed
  from a single provider would only bake in that provider's shape (auth model, id
  semantics, `snapshot_id`) under a generic name.
- **No canonical tracks table.** Tracks exist only to fill Spotify playlists; a
  two-layer registry like artists/events would be pattern-matching without a payoff.
  If an Apple Music target ever lands, revisit.
- **`artist_top_tracks` parents the canonical artist, not `spotify_artists`.** The
  ranking (`rank`, `title`) is a fact about the artist, sourced from Last.fm;
  `spotify_track_id` is a resolution detail - the same split the provider-migration
  note above relies on. Consumers also speak canonical: the desired-state query joins
  interests -> events -> `artists.id` -> top tracks with no identity-row hop. The cost
  is invalidation: the cache is only valid for the Spotify resolution its tracks were
  verified against, so replacing an artist's `spotify_artists` row (correcting a bad
  fuzzy match) must also purge their `artist_top_tracks` rows - a cascade would have
  done this for free, but resolutions change rarely and the purge is one line in the
  same code path.
- **Cache freshness lives on `spotify_artists.top_tracks_synced_at`** (the same shape
  as `lastfm_artists.last_synced_at`): one timestamp per artist, globally shared, TTL
  around 30 days. Each re-sync replaces the artist's whole `artist_top_tracks` set.
- **Failed track matches are simply absent.** If only 3 of 5 Last.fm top tracks
  resolve on Spotify, the artist contributes 3 songs; rank gaps are fine.

## Sync semantics

`sync(playlist)`:

1. Refresh inputs if stale: resolve any unresolved matched artists, re-fetch top
   tracks past TTL. (Event freshness is the event sync's job, not this one's.)
2. Compute the desired tracklist (query above).
3. If the playlist has no `spotify_playlist_id`, create it
   (`POST /v1/me/playlists`, public) and store the ID and URL. Created lazily on
   first sync, even if the tracklist is currently empty - an empty playlist with the
   right name and description is a working product surface.
4. Write the whole desired list as one full replace (`PUT /v1/playlists/{id}/items`
   with `uris`; the 100-track cap keeps it a single request). Rewrite
   `playlist_tracks` to match when it changed, and store the returned `snapshot_id`.
   If name or description changed, push those too.
5. Touch `last_synced_at`.

The original design used delta writes (remove/add/reorder) to protect Spotify's
per-item `added_at`, on the community-lore assumption that a full replace resets it.
Phase 0 disproved that: replace preserves `added_at` for surviving tracks (see the
findings under Phases). That collapses the trade-off - replace is atomic, needs no
diff base, and is self-healing by construction (drift from manual edits on the
Spotify side is overwritten on every sync, no `snapshot_id` tripwire needed). The
`added_at` semantics the "Date added" sort relies on survive intact: surviving tracks
keep their timestamps, a new track reads as just-added exactly because its show was
just announced, and a song that leaves (show passed) and later returns (new show
announced) correctly reads as newly added again.

Deleting a playlist (user deleted, or a future "turn it off") means unfollowing it on
the Spotify side (`DELETE /v1/playlists/{id}/followers` - Spotify has no true delete)
before or after removing local rows; an orphaned public playlist on the bot account is
the failure mode to avoid.

## Bot account, auth, and configuration

- A dedicated Spotify account owns every playlist. It authorizes the app **once** via
  the authorization code flow (a browser step, manual) with `playlist-modify-public`;
  the refresh token lands in `.env` and the backend mints hourly access tokens from it.
  Users never touch Spotify auth.
- **Refresh tokens expire after 6 months** (Spotify, June 2026). The token endpoint
  returns `invalid_grant` when it happens; the client surfaces that as a loud,
  distinguishable error, and re-auth is the same one-time browser step. A small CLI
  helper (`python -m app.spotify_auth`) that prints the authorize URL and exchanges the
  code keeps the twice-a-year ritual painless.
- New settings: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` -
  all secrets, so `${KEY:?set in .env}` in compose per the config convention.
- `SpotifyClient` in `backend/app/spotify.py`, injected like `LastfmClient`. Every
  Spotify touchpoint goes through it - if Spotify tightens development mode again, or
  the project ever outgrows it, the blast radius is one module. It honors 429
  `Retry-After` and backs off; development-mode rate limits are unpublished and low.
- Registration facts to plan around: the app-owning developer account needs Premium
  (if the bot account owns the registration, the bot needs Premium); one
  development-mode Client ID per developer; the bot account must be added to the app's
  user allowlist (1 of 5 slots).

## Naming and content policy

Title referencing the user and target city: `"<name>'s shows in <city>"`, description
like `"Artists you love playing near <city>. Updated <month year>."`. Constraints that
matter: nothing implying Spotify endorsement or co-branding, attribution/linkback when
we display Spotify metadata in our own UI, and both APIs are non-commercial-terms
(Last.fm ToS, Spotify development mode) - fine for this project, a real constraint if
it ever becomes a product.

A mass-creating bot is also the shape anti-abuse tooling watches for; playlist creation
happens per real user at human-ish rates, which is what the lazy-create flow produces
naturally.

## Risks

- **Spotify keeps tightening development mode** (three rounds since Nov 2024; endpoint
  removals, field removals, user-count cuts). Mitigations: everything behind
  `SpotifyClient`; track selection already independent of Spotify; the canonical
  registry means a different playlist target is a new identity table, not a redesign.
- **Search-based track matching is fuzzy.** Verifying the track's artist ID against the
  resolved `spotify_artists` row removes the worst failure mode (wrong artist); wrong
  *version* (live, remaster, karaoke cover) needs title heuristics tuned empirically in
  Phase 2.
- **Market availability**: search runs as the bot account, so results skew to the bot's
  country; a URI can be unplayable in the user's market. Accepted for V1 (users and bot
  start in the same country); revisit if users spread.

## Phases

**Phase 0 - verify Spotify reality.** Register the app, create the bot account,
allowlist it, run the auth flow once. From a throwaway script: create a playlist,
add/remove/reorder items, confirm search behavior and limits, confirm `top-tracks`
really is gone, and confirm the `added_at` behavior the delta-write design rests on
(full replace resets it, reorder preserves it) - community-confirmed, not documented.
Everything below assumes these hold.

Findings (verified July 2026, `python -m app.spotify_verify`): search, create,
replace, details update, and item reads all work as designed; `top-tracks` and
batch `/artists?ids=` return 403; `popularity`/`followers` are stripped; search
`limit` caps at 10. One shape change vs. the classic API: the items payload nests
the track under `item` (not `track`). One assumption did not survive: full replace
(`PUT` with `uris`) now *preserves* `added_at` for surviving tracks - including
across reorders and removals, and `{"uris": []}` cleanly empties a playlist - so
the sync writes a single full replace instead of the delta calls this plan
originally specified (see Sync semantics).

**Phase 1 - schema + client.** One migration for the four tables. `SpotifyClient` with
`search_artists`, `search_tracks`, `create_playlist`, `replace_playlist_items`,
`update_playlist_details`, `unfollow_playlist`, plus the token-refresh plumbing and
the `spotify_auth` CLI helper. Extend `LastfmClient` with `get_artist_top_tracks`.

**Phase 2 - artist resolution + track cache.** Resolve matched artists to
`spotify_artists` (MBID path, then search path), ingest `artist_top_tracks` with the
freshness gate. Exposed as part of sync rather than a user-facing endpoint.

**Phase 3 - playlist sync + management.** `POST /users/{id}/playlists/sync` running
the full reconcile over all of the user's playlists, `GET /users/{id}/playlists`
returning playlists with tracks and provenance (artist + show per track), plus
pinned-playlist management: `POST /users/{id}/playlists` (pin a city, subject to the
cap) and `DELETE /users/{id}/playlists/{playlist_id}` (unfollow on Spotify, then
delete locally). Same refresh-endpoint pattern as the other plans.

**Phase 4 - background refresh.** The scheduled task from the other plans' final phases
gains a step: after event refresh, re-sync playlists whose inputs changed (or simply
all active playlists - reconciliation is cheap when the diff is empty).
