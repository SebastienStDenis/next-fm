# Artist suggestions design

How the system recommends artists the user does *not* know, so playlists become a
discovery product ("a band you'd love is playing Thursday") instead of a tour tracker
for artists they already listen to. This is the layer `docs/artist-matching-plan.md`
explored; this doc commits to a direction, adds the suggestion lifecycle, and specifies
the "include artists I know" setting.

## Terminology: known artists vs suggested artists

Two terms, used everywhere - docs, code constants, API copy. Both are relations
between a user and an artist derived from interest kinds, never properties of the
artist itself (the same artist can be known to one user, suggested to another, and
neither to a third, sitting in the registry only because of someone else's taste):

- **Known artist**: the user has at least one interest of a *known kind* - a kind
  asserting they demonstrably listen to the artist - clearing that kind's weight
  floor on *organic* plays (floors and the served-track discount close the scrobble
  feedback loop; see "The playlist scrobbles back").
  `KNOWN_ARTIST_KINDS = {lastfm_top_artist, lastfm_loved_tracks}`; future taste
  sources add their kinds here.
- **Suggested artist**: the user has at least one interest of a *suggested kind* - a
  kind written by the suggestion engine - and **no known-kind interest**.
  `SUGGESTED_ARTIST_KINDS = {similar_artist}`; a future suggestion signal
  (content-based fallback, another service's similarity) is a new kind in this set,
  not a new classification.

The "no known-kind interest" clause makes the two classifications disjoint - and
the disjointness is an *invariant the suggestion engine maintains at sync time*, not
something queries re-derive: deciding "organically known" can take API calls (the
served-track discount), so suggestion sync alone makes that call, and everything
else classifies purely by which rows exist. "Discovery" stays as the name of the product capability, and user-facing
copy can say "new artists" or "artists you might like"; but whenever an artist is
being classified - in schema, code, queries, or these docs - the terms are known and
suggested, nothing else.

## Decision: expand the user's interest set, don't score the event inventory

The matching notes sketched two directions for collaborative similarity
(`artist.getSimilar`): fetch similar lists per *event artist* and score each local
event against the user's taste, or fetch per *user artist* and expand the user's
profile outward. For scoring an existing inventory, per-event-artist wins -
but this system has no inventory to score. Event ingestion is artist-first: an event
only enters the database because some user's interest artist published it. An artist
nobody tracks never gets their events fetched, so scoring local event artists can
never surface anyone new - with a small user base the event-artist pool *is* the
user's own artists.

Discovery therefore has to widen the interest set before events enter the picture:

1. Seed from the user's strongest taste signals (their top Last.fm artists).
2. Fetch each seed's similar artists, score candidates, keep the best few dozen.
3. Write them as interest rows with a suggestion-specific `kind`.

From there the existing pipeline does everything for free, exactly as the event plan
anticipated: event sync fetches tour dates for every distinct interest artist without
asking why the interest exists, the match join finds nearby shows, and the playlist
layer already carries per-track provenance. Nothing downstream grows a
suggested-vs-known branch.

Per-event-artist edges remain the right shape for a *future* multi-user scoring tier
(rank another user's artist playing nearby against my taste); the edge table below is
deliberately reusable for that. Not built now.

## Where the flow lives: a fourth sync stage

Suggestions are a new pipeline stage between taste sync and event sync, in their own
module with their own endpoint, following the one-endpoint-per-stage pattern:

```
POST /users/{id}/lastfm/artists/sync    taste       (exists)
POST /users/{id}/suggestions/sync       suggestions (new: app/suggestion_sync.py)
POST /users/{id}/events/sync            events      (exists, picks up suggestions untouched)
POST /users/{id}/playlists/sync         playlists   (exists, gains the setting filter)
```

Why its own stage rather than a side effect of an existing one:

- **Not inside taste sync**: different cadence (taste moves weekly; similarity lists
  drift over months), different failure profile (~30 extra API calls that shouldn't
  fail the taste sync), and the sync-ownership rule stays clean - each stage upserts
  and prunes only its own interest `kind`.
- **Not at event or playlist time**: too late by construction. Interests drive event
  fetching, so suggestions must exist as interests before event sync runs, and the
  playlist layer is a pure function of local data with no API calls of its own.

Suggested artists surface in `GET /users/{id}/artists` automatically, with their
evidence as the "because you listen to X" reason - no new read endpoint.

## Algorithm

### Seeds

The user's top `SUGGESTION_SEED_COUNT = 30` artists by `lastfm_top_artist` rank,
skipping excluded artists (below). Seeds cap the API cost (one `getSimilar` call each,
freshness-gated) and the top of the list is where taste signal is strongest; artist
number 150 of 200 says little.

### Edges

For each stale seed (`similar_synced_at` older than `SIMILAR_TTL = 30 days`), fetch
`artist.getSimilar(limit=100)` and replace that seed's rows in
`lastfm_similar_artists` (schema below). Similarity lists are near-static, so the TTL
is long and refreshes are cheap after the first sync.

### Scoring

For each candidate (any artist appearing in any seed's similar list):

```
affinity(seed)   = 1 - 0.5 * (rank - 1) / (SEED_COUNT - 1)     # linear 1.0 -> 0.5
                   * 1.15 if the seed also has a loved-tracks interest, capped at 1.0
path(seed, cand) = match(seed, cand) * affinity(seed)
score(cand)      = best path + 0.05 * min(count of other paths >= 0.2, 4)
```

- **Affinity is deliberately flat** (1.0 down to 0.5, not 1/rank). Every seed is
  already a top-30 artist; a steep decay would collapse the effective seed set to a
  handful and starve eclectic taste - the failure mode the matching notes warned
  averaging would cause.
- **Max path first, consensus second.** One strong path is the best predictor (the
  doom-metal argument from the matching notes), but for *suggestions* - where we
  choose what to bet a standing event-sync commitment on - an artist similar to five
  of your seeds deserves an edge over a one-path wonder. The bonus is small and capped
  (+0.2 max) so a pile of weak paths cannot outrank one strong edge.

### Known-artist filtering

A suggested artist must not be a known artist, so candidates are dropped when:

- they are already known (a `KNOWN_ARTIST_KINDS` interest clearing its weight floor
  on organic plays - both floor and served-track discount per "The playlist
  scrobbles back"), or
- they appear in the user's *overall*-period top artists with the same floor and
  discount applied (the response carries playcounts): one extra
  `user.getTopArtists(period="overall", limit=1000)` call at suggestion-sync time,
  used purely as an in-memory blocklist, never stored. The 12-month top-200 misses
  artists the user knows well but hasn't played lately; this catches most of them for
  one request. (`library.getArtists`, the complete listening history, is the exhaustive
  version - thousands of pages for heavy users, deferred.)
- they are excluded by the user (the overrides table below).

### Selection, with hysteresis

A candidate becomes or stays a suggestion when:

- score >= `SUGGESTION_ENTER_SCORE = 0.45` (new suggestions), or
- score >= `SUGGESTION_EXIT_SCORE = 0.35` and it is already a suggestion
  (incumbents), or
- it is an incumbent whose artist has an upcoming matched show - retained regardless
  of score or known classification (see "The playlist scrobbles back").

Rank qualifiers by score, incumbents winning ties, and keep the top
`SUGGESTION_CAP = 50`. The enter/exit gap and the tiebreak damp churn: a candidate
oscillating around a single cutoff would otherwise flap in and out of the interest
set, dragging event fetches and playlist rewrites with it every cycle.

Every threshold above is an empirical starting point, not a calibrated value -
`getSimilar` match scores are normalized per list (a tiny artist's top neighbor gets
~1.0 as easily as a huge artist's), so precision is unknowable from the armchair.
Phase 2 ends with a calibration run against a real linked account: eyeball the top 50
for "would I plausibly like this and do I genuinely not know it", adjust constants,
record findings in the PR. Listener-count damping of small-list scores is the known
lever if tiny artists come out inflated (deferred).

## Schema

```
lastfm_similar_artists         -- cached getSimilar edges, global, shared across users
  id                 uuidv7 PK
  artist_id          FK -> artists.id (cascade, index)   -- the seed
  name               str          (Last.fm's name for the similar artist)
  name_key           str (index)  (casefolded, same authority as lastfm_artists)
  mbid               str | None
  match              float        (Last.fm's 0-1 score)
  created_at / updated_at
  unique (artist_id, name_key)

lastfm_artists                 -- one new column
  similar_synced_at  timestamptz | None    (freshness stamp for this artist's edges)

users                          -- one new column
  include_known_artists  bool NOT NULL server_default false

user_artist_interests          -- one new column
  weight             float | None   (kind-specific strength: playcount for
                                     lastfm_top_artist, track_count for
                                     lastfm_loved_tracks, score for similar_artist)

user_artist_exclusions        -- user policy: never suggest, never seed, never match
  id                 uuidv7 PK
  user_id            FK -> users.id (cascade)
  artist_id          FK -> artists.id (cascade, index)
  created_at
  unique (user_id, artist_id)

user_artist_served_tracks     -- append-only: suggestion tracks we put in playlists
  id                 uuidv7 PK
  user_id            FK -> users.id (cascade)
  artist_id          FK -> artists.id (cascade, index)
  title              str          (Last.fm title, the key track.getInfo needs)
  first_served_at    timestamptz
  unique (user_id, artist_id, title)
```

Design notes:

- **`weight` is the column the artist plan deliberately deferred** "until the
  scoring/playlist layer exists to consume it" - that consumer now exists: the
  suggestion engine's known-classification floors and selection compare against it
  as a typed column, keeping the "resist querying into `evidence`" rule intact.
  Each sync writes its own kinds' weights; the migration backfills existing rows
  from evidence (`(evidence->>'playcount')::float`,
  `(evidence->>'track_count')::float`).
- **Edges point at the seed canonically but name the target by `name_key`, not FK.**
  Thirty seeds' lists are up to ~3000 names per user, most of which will never clear
  the threshold; minting canonical `artists` rows for all of them would fill the
  registry with junk that every future dedupe, listing, and resolution pass pays for.
  Only candidates that become suggestions go through the existing ingestion path
  (`_upsert_lastfm_artists` by `name_key`) and get canonical rows. The future
  event-artist scoring join reaches canonical ids through `lastfm_artists.name_key`
  (unique), so nothing is lost. Cost: scoring aggregates app-side rather than as one
  SQL join - trivial at 3000 in-memory rows per user.
- **`user_artist_served_tracks` is the permanent taint record** behind the
  served-track discount (see "The playlist scrobbles back"): written by playlist
  sync whenever it writes a suggested artist's tracks, never pruned - an artist's
  re-suggestibility must stay computable on a tour two years out. Unlike
  `playlist_tracks` (rewritten every sync) and `artist_top_tracks` (a volatile
  cache), these rows are history, and they are tiny: three per suggested artist per
  user.
- **Edges are a persistent cache, not a log**: each seed re-fetch replaces that seed's
  whole edge set (the `artist_top_tracks` pattern). Persisting them (rather than
  scoring straight off the API response) buys the 30-day TTL across users sharing
  seeds, re-scoring during threshold tuning without re-fetching, and the future
  event-side join. `limit=100` keeps the table well under the Last.fm 100 MB
  stored-data cap at any plausible scale.
- **Exclusions are a table, not interest-row deletion.** Source-owned interest rows
  are facts ("you listened to X"), and the next taste sync would simply recreate a
  deleted one - deletion cannot express "yes I listen to it, but don't act on it".
  The exclusion row is user policy: durable, owned by no sync, never pruned. The
  planned "ignore this artist" UI writes here. Enforcement points: suggestion sync
  drops excluded seeds and candidates; the shared match join filters excluded artists
  unconditionally (both the events view and playlist desired state). Creating an
  exclusion also immediately deletes any existing `similar_artist` interest row for
  that pair - safe because the suggestion engine owns that kind and would prune it
  next sync anyway; playlist reconciliation then removes its tracks on the next
  playlist sync with no special handling.

### The interest rows

Suggestions are ordinary `user_artist_interests` rows:

| column   | value |
| -------- | ----- |
| kind     | `similar_artist` |
| source   | `internal` |
| evidence | `{"score": 0.58, "paths": [{"seed_artist_id": "...", "seed_name": "Slowdive", "match": 0.84}, ...]}` (top 3 paths) |

`source` is `internal`, not `lastfm`: the edges come from Last.fm, but the row records
our engine's decision (aggregation, thresholds, caps, exclusions). A future suggestion
signal (Spotify related artists, the pgvector fallback) lands as its own kind added to
`SUGGESTED_ARTIST_KINDS`, keeping per-kind sync ownership - it changes nothing
downstream, since everything classifies through the kind sets. `weight` carries the
score, so selection and floors never parse JSONB; evidence carries denormalized seed
names so the UI renders "because you listen to Slowdive" without joins.

## Lifecycle: suggestions are derived state, recomputed and replaced

Each suggestion sync recomputes the desired suggestion set from current inputs (seeds,
edges, exclusions, known-artist set) and replaces the user's `similar_artist` rows -
the same recompute-and-reconcile principle as playlists, one layer down. Removal
handling therefore needs no per-cause code:

- **A seed drops out of the user's top artists**: taste sync deletes its
  `lastfm_top_artist` row; on the next suggestion sync every path through that seed is
  gone, and any candidate that no longer clears the (exit) threshold or the cap loses
  its interest row. Suggestions justified by remaining seeds survive untouched.
- **The user excludes an artist**: dropped as seed and as candidate at the next
  recompute, plus deleted immediately by the exclusion write (above).
- **A suggested artist becomes known** (clears the floor on organic plays, or gets a
  loved track): the known-artist filter drops it and the known-kind row takes over
  justifying the artist - but never while it still has an upcoming matched show.
  Both the floor and that grace exist to keep playlist listening from evicting its
  own suggestions; see the next section.

Downstream cleanup is automatic and already built: an artist referenced by no
interest row simply stops being event-synced (the fetch loop is interest-driven), its
stored events age out past `starts_at`, and playlist reconciliation drops its tracks
on the next sync because the desired-state query no longer matches them. Nothing
orphaned needs chasing.

The one deliberate non-cleanup: `lastfm_similar_artists` edges persist after their
seed stops being anyone's seed. They are a global cache keyed by artist, not per-user
state - another user's sync may want them tomorrow, and staleness is already handled
by the TTL.

## The playlist scrobbles back: closing the feedback loop

The product writes its own input: the user plays the generated playlist, the plays
scrobble to Last.fm, and suggested artists start climbing the very lists that define
"known". Untreated, the loop is vicious under the setting's default state - rank in
the 12-month top 200 exists for any artist with a single scrobble, so a listener with
fewer than 200 ranked artists mints a `lastfm_top_artist` row for every playlist
artist after one listen-through, and the overall-top-1000 blocklist trips even
easier. The next suggestion sync would reclassify them known, prune the suggestions,
and the following playlist sync would strip their tracks - before the user decided
whether they like the artist, let alone bought a ticket.

Three mechanisms close the loop, protecting different windows:

- **Playcount floors: presence is not knowing.** A `lastfm_top_artist` interest
  counts toward the known classification only when its weight (playcount) clears
  `KNOWN_PLAYCOUNT_FLOOR = 20`, and the overall-top-1000 blocklist applies the same
  floor. This filters trace exposure - a few organic radio plays, one pass through
  the playlist - but a static floor can do no more than that: a playlist looped over
  a show window crosses any value we pick (three served tracks times seven listens
  is 21 plays), so the floor is the cheap first gate, not the re-suggestibility
  story. Loved tracks get no floor - loving a track is an explicit act, not scrobble
  residue.
- **Show-tied grace: no mid-decision evictions.** An incumbent suggestion whose
  artist still has an upcoming matched show is retained through recomputes regardless
  of score or known classification; it is re-evaluated only once the show has passed.
  (Exclusion always wins - "ignore this artist" takes effect immediately.) The
  suggestion exists to sell that show; evicting it while the decision is live defeats
  the product, and a user who plays a suggested artist forty times before the gig is
  the success case, not cleanup. Retained incumbents still count against
  `SUGGESTION_CAP`, keeping the event-fetch commitment bounded, and the check is one
  local query against events - no API cost.
- **Served-track discount: plays we caused never make an artist known.** This is
  what actually protects re-suggestibility - the floor alone would let one
  well-looped playlist mark an artist known forever, killing their next tour's
  suggestion. The plays a playlist generates land on exactly the tracks we chose,
  and we record which those are: playlist sync appends every suggested artist's
  served titles to `user_artist_served_tracks` (schema above). When a
  previously-served artist's playcount sits above the floor, suggestion sync fetches
  the user's plays of those specific titles - `track.getInfo` takes a `username` and
  returns `userplaycount` - and classifies on the organic remainder:
  `organic = playcount - sum(served-title userplaycounts)`, clamped at zero, known
  only when `organic >= KNOWN_PLAYCOUNT_FLOOR`. The user who looped the playlist all
  season stays suggestible next tour (organic near zero); the user who went off and
  played the albums crosses on unserved tracks alone. The window mismatch
  (`userplaycount` is lifetime, the artist playcount is 12-month) only under-counts
  organic plays, erring toward re-suggesting - the right direction. Cost: about
  three calls per artist, only for previously-served artists above the floor.

One structural consequence: the match join cannot evaluate "organically known"
itself (the discount needs API calls), so suggestion rows become the single source
of truth for the suggested classification. Suggestion sync maintains the
disjointness invariant - it prunes a suggestion only when the artist is organically
known and out of show-grace - and the match join filters by kind sets and exclusions
alone. Between syncs a freshly-adopted artist can linger in a suggested-only
playlist until the next suggestion sync; harmless lag, resolved by the same
recompute that admits it.

Full attribution - trawling `user.getRecentTracks` against serve history - stays the
heavyweight fallback if `track.getInfo`'s `userplaycount` proves unreliable or
privacy-blocked (to verify empirically); snapshotting playcounts at serve-window
boundaries and discounting the delta is the all-local alternative.

## The "include artists I know" setting

`users.include_known_artists`, boolean, default **false**: playlists contain only
suggested artists unless the user opts known artists in.

- **Semantics when false**: only suggested artists qualify for matching -
  implemented as "has a suggested-kind interest", full stop. The join does not
  re-check known-ness: it cannot (the served-track discount needs API calls), so it
  trusts the disjointness invariant suggestion sync maintains. A freshly-adopted
  artist can linger one suggestion-sync cycle in a suggested-only playlist - a user
  hearing an artist they just started loving is a benign failure. When true: known
  and suggested artists both qualify. Exclusions filter regardless of the setting.
- **Where it applies**: in the shared match join, which moves from
  `playlist_sync._match_artists` (and its duplicate in the events endpoint) into
  `matching.py`, parameterized by the setting and the exclusion filter. Both the
  events view and playlist desired state get identical behavior for free; the events
  endpoint gains an optional override param so the UI can still show everything.
- **Not applied to ingestion**: event sync keeps fetching events for *all* interest
  artists, known ones included. The setting shapes presentation, not data; toggling
  it then takes effect on the next playlist sync instead of waiting out a full event
  re-fetch. Cost: some Bandsintown calls for artists that never surface while the
  setting is false - accepted, it keeps the event pipeline's "never asks why" rule.
- **Per user, not per playlist, for now.** A "suggested-artists playlist alongside a
  known-artists playlist" product wants this per playlist (a new `kind`), and the playlists table
  already supports that; the user-level setting is the V1 knob and can become the
  default for new playlists later without migration pain.
- **API surface**: `include_known_artists` on `UserRead`, plus
  `PATCH /users/{user_id}` to set it. Additive, so the existing frontend keeps
  working unchanged.

### Rollout consequence (the one breaking behavior change)

With the default false, every existing playlist flips from known artists' shows to
suggested artists only at its next sync - and to *empty* if no suggestion sync has
run yet. Post-deploy order matters: taste sync, then suggestions, then events, then
playlists. The playlist description also stops being true; sync starts choosing copy
by the setting ("New artists you might like playing near {city}" vs the current
"Artists you love playing near {city}"). No frontend changes are required - response
shapes are unchanged or additive - but the Concerts panel will show only
suggested-artist events by default, which is the intended product pivot.

## Playlist layer tweak: fewer tracks per suggested artist

The per-kind weighting the playlist plan reserved space for:
`TOP_TRACKS_PER_ARTIST` stays 5 for known artists, `SUGGESTED_TRACKS_PER_ARTIST = 3`
for suggested artists. A suggested artist is a cheaper bet at three tracks, and a
suggested-only playlist fits more artists under the 100-track cap. Ordering, dedupe, provenance, and the full-replace write are
untouched.

## Volume and rate limits

Per user, steady state: 30 `getSimilar` calls per 30 days (often fewer - seeds shared
across users share edges), one `getTopArtists(overall)` call per suggestion sync, and
up to 50 suggested artists joining the 24h-TTL Bandsintown rotation - the standing
commitment the event plan flagged, bounded by `SUGGESTION_CAP` exactly as it
prescribed. Suggested artists that match a show enter Spotify resolution and
top-track caching like any other artist, already bounded by match count. All well
inside the ~5 req/s Last.fm ceiling even syncing several users back to back.

## Deferred, in likely order of need

1. **Threshold calibration and listener-count damping** - after real data (end of
   Phase 2).
2. **Exhaustive known-artist blocklist** via `library.getArtists` pagination, if
   overall-top-1000 lets too many known artists through.
3. **Two-hop profile expansion** (matching plan's recall lever) if good matches
   visibly score zero - same edge table, seeds gain expanded neighborhoods, scores
   damped by both hops.
4. **Event-artist-side edges** for multi-user scoring ("someone else's artist plays
   near you"), reusing `lastfm_similar_artists` in the fetch-per-event-artist
   direction.
5. **Content-based fallback** (pgvector) for no-audience artists, per the matching
   notes.

## Phases

**Phase 1 - schema + client.** One migration: `lastfm_similar_artists`,
`lastfm_artists.similar_synced_at`, `users.include_known_artists`,
`user_artist_exclusions`, `user_artist_served_tracks`, and
`user_artist_interests.weight` (backfilled from evidence). Taste sync starts
writing weights for its kinds.
`LastfmClient.get_similar_artists(name, limit)` in the existing style, with
not-found handled like `get_artist_top_tracks`.

**Phase 2 - suggestion sync.** `app/suggestion_sync.py` (seeds, freshness-gated edge
fetch, scoring, selection with hysteresis, known-classification floors with the
served-track discount, show-tied retention of incumbents, interest replacement,
exclusion enforcement),
`POST /users/{id}/suggestions/sync` returning a sync-result schema in the
established shape (seeds synced/skipped, candidates scored, suggestions
created/kept/removed). Ends with the calibration run against a real account.

**Phase 3 - the setting + match integration.** Consolidate the match join into
`matching.py` with kind and exclusion filters; wire it into the events endpoint
(override param) and playlist desired state; per-kind track counts; playlist sync
starts appending `user_artist_served_tracks` as it writes suggested artists' tracks;
setting-aware playlist description; `UserRead` field and `PATCH /users/{user_id}`.

**Phase 4 - exclusion endpoints + background refresh.** The "ignore this artist"
write path (`PUT`/`DELETE /users/{id}/artists/{artist_id}/exclusion`) landing with
its UI; the scheduled-refresh job from the other plans gains the suggestions stage in
pipeline order.

## To verify empirically (undocumented)

- `artist.getSimilar`: real maximum and behavior of `limit`; whether match scores are
  per-list normalized as believed (spot-check a huge vs a tiny artist); error shape
  for unknown artists; whether zero-match padding rows appear.
- `user.getTopArtists(period="overall")`: whether `limit=1000` works in one call.
- `track.getInfo` with `username`: whether `userplaycount` is returned reliably, and
  whether the "hide recent listening" privacy setting blanks it (the served-track
  discount falls back to `getRecentTracks` trawling or local snapshots if so).
- Match-score distribution across popularity tiers, to seat the enter/exit thresholds.
