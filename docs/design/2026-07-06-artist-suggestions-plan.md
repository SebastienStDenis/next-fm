# Artist suggestions design

*Written 2026-07-06 by Claude (Fable 5).*

How the system recommends artists the user does *not* know, so playlists become a
discovery product ("a band you'd love is playing Thursday") instead of a tour tracker
for artists they already listen to. This is the layer `docs/2026-07-06-artist-matching-plan.md`
explored; this doc commits to a direction, adds the suggestion lifecycle, and specifies
the "include artists I know" setting.

## Terminology: known artists vs suggested artists

Two terms, used everywhere - docs, code constants, API copy. Both are relations
between a user and an artist derived from interest kinds, never properties of the
artist itself (the same artist can be known to one user, suggested to another, and
neither to a third, sitting in the registry only because of someone else's taste):

- **Known artist**: the user has at least one interest of a *known kind* - a kind
  asserting they demonstrably listen to the artist - clearing that kind's weight
  floor (floors close the scrobble feedback loop; see "The playlist scrobbles
  back"). `KNOWN_ARTIST_KINDS = {lastfm_top_artist, lastfm_loved_tracks}`; future
  taste sources add their kinds here.
- **Suggested artist**: the user has at least one interest of a *suggested kind* - a
  kind written by the suggestion engine - and **no known-kind interest**.
  `SUGGESTED_ARTIST_KINDS = {similar_artist}`; a future suggestion signal
  (content-based fallback, another service's similarity) is a new kind in this set,
  not a new classification.

The "no known-kind interest" clause makes the two classifications disjoint - and
the disjointness is an *invariant the suggestion engine maintains at sync time*, not
something queries re-derive: known-ness carries nuance a join shouldn't reimplement
(weight floors, the show-grace window), so suggestion sync alone makes that call,
and everything else classifies purely by which rows exist. "Discovery" stays as the name of the product capability, and user-facing
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
  drift over months), different failure profile (up to a couple hundred extra API
  calls that shouldn't fail the taste sync), and the sync-ownership rule stays clean
  - each stage upserts and prunes only its own interest `kind`.
- **Not at event or playlist time**: too late by construction. Interests drive event
  fetching, so suggestions must exist as interests before event sync runs, and the
  playlist layer is a pure function of local data with no API calls of its own.

Suggested artists surface in `GET /users/{id}/artists` automatically, with their
evidence as the "because you listen to X" reason - no new read endpoint.

## Algorithm

### Seeds

Every known artist is a potential seed, skipping excluded artists (below) - there is
no seed-count knob. A rank cutoff ("top 30") would be decision-relevant truncation:
affinity is still meaningful at any such boundary, so seed #31 could have minted a
suggestion the cutoff silently discards, and two artists separated by a single play
would land on opposite sides of an in/out cliff. The only seed filter is *derived*
from the decision thresholds: a seed's similar list is fetched and scored only when
its affinity clears the path-qualification bar (`affinity >= 0.2`, the same constant
the consensus bonus uses below) - a weaker seed cannot reach that bar even with a
perfect match, so skipping it provably cannot change the output. Same taste data in,
same suggestions out; the skip is API savings, not a taste judgment. (One truncation
always remains - Last.fm ends the top-artists list at whatever limit we fetch - but
that boundary sits in tail territory where affinity cannot clear thresholds, which
is the test that matters.)

### Edges

For each stale eligible seed (`similar_synced_at` older than `SIMILAR_TTL = 30
days`), fetch `artist.getSimilar(limit=100)` and replace that seed's rows in
`lastfm_similar_artists` (schema below). Similarity lists are near-static, so the TTL
is long and refreshes are cheap after the first sync.

### Scoring

For each candidate (any artist appearing in any eligible seed's similar list):

```
affinity(seed)   = log1p(seed playcount) / log1p(user's max artist playcount)
                   # loved-tracks-only seeds: min(0.4 + 0.15 * track_count, 1.0);
                   # an artist known through both signals takes the stronger
path(seed, cand) = match(seed, cand) * affinity(seed)
score(cand)      = best path + 0.05 * min(count of other paths >= 0.2, 4)
```

- **Affinity comes from playcount, not rank.** Rank manufactures differences between
  near-ties - one extra play must not flip an artist's treatment, and with
  playcount-derived affinity it doesn't (equal playcounts, equal affinity) - and any
  rank-shaped affinity makes seed cutoffs into cliffs. Log-scaling against the
  user's *own* maximum normalizes heavy against light listeners; a share-of-total
  denominator would not (it penalizes broad listeners, whose favorite is 2% of
  their listening where a casual user's is 15%). The loved-tracks formula is a
  starting point like every constant here: loving tracks by an artist is a strong
  signal at any playcount.
- **Max path first, consensus second.** One strong path is the best predictor (the
  doom-metal argument from the matching notes), but for *suggestions* - where we
  choose what to bet a standing event-sync commitment on - an artist similar to five
  of your seeds deserves an edge over a one-path wonder. The bonus is small and capped
  (+0.2 max) so a pile of weak paths cannot outrank one strong edge.

### Known-artist filtering

A suggested artist must not be a known artist, so candidates are dropped when:

- they are already known (a `KNOWN_ARTIST_KINDS` interest clearing its weight floor,
  per "The playlist scrobbles back"), or
- they appear in the user's *overall*-period top artists with the same playcount
  floor applied (the response carries playcounts): one extra
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
  (incumbents).

Clearing a threshold is necessary, never bypassed: a candidate classified as known
is then dropped - unless it is an incumbent whose artist has an upcoming matched
show, the show-tied grace of "The playlist scrobbles back". Grace excuses known-ness
and nothing else; a suggestion whose score genuinely collapses leaves even
mid-window.

Qualifiers are ranked by score and kept up to `SUGGESTION_BUDGET = 200`, with
deterministic tie-breaks (incumbency first, then `name_key`) so equal inputs always
yield equal outputs. The budget is deliberately *not* part of the taste algorithm -
the thresholds above are the quality boundary. It exists because every suggestion
interest is a standing commitment to re-fetch that artist's Bandsintown feed every
event-sync TTL, and score thresholds alone don't bound that volume (a broad-taste
user can clear the enter score for hundreds of candidates). The user-facing surface
is already bounded by the real limit (the 100-track playlist); the budget projects
the ingestion cost upstream, is set generously so most users never touch it, and
gets tuned against observed Bandsintown volume rather than product intuition. The
enter/exit gap and the incumbency tie-break damp churn: a candidate oscillating
around a single cutoff would otherwise flap in and out of the interest set,
dragging event fetches and playlist rewrites with it every cycle.

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
  playlist sync with no special handling. Excluding a *seed* cascades with no extra
  machinery: its paths disappear from scoring, so every suggestion that stood only
  on it fails the exit threshold at the next suggestion sync and is pruned, upcoming
  shows notwithstanding (grace never overrides score) - one exclusion purges the
  whole lineage, e.g. taste contamination from a shared account, while suggestions
  with independent support survive on their own merit.

### The interest rows

Suggestions are ordinary `user_artist_interests` rows:

| column   | value |
| -------- | ----- |
| kind     | `similar_artist` |
| source   | `internal` |
| evidence | `{"score": 0.58, "paths": [{"seed_artist_id": "...", "seed_name": "Slowdive", "match": 0.84}, ...]}` (top 3 paths) |

One row per (user, artist, kind): a candidate recommended by many seeds still gets a
single `similar_artist` row - the multiplicity lives in the edge table and in the
score's path aggregation, with the top contributors named in evidence. A second
*kind* is the only thing that adds rows, exactly as known artists already hold
separate top-artists and loved-tracks rows.

`source` is `internal`, not `lastfm`: the edges come from Last.fm, but the row records
our engine's decision (aggregation, thresholds, caps, exclusions). A future suggestion
signal (Spotify related artists, the pgvector fallback) lands as its own kind added to
`SUGGESTED_ARTIST_KINDS`, keeping per-kind sync ownership - it changes nothing
downstream, since everything classifies through the kind sets. `weight` carries the
score, so selection and floors never parse JSONB; evidence carries denormalized seed
names so the UI renders "because you listen to Slowdive" without joins.

## Lifecycle: suggestions are derived state, recomputed and replaced

Each suggestion sync recomputes the desired suggestion set and reconciles the user's
`similar_artist` rows against it. The inputs are the current taste data (seeds,
edges, exclusions, known-artist set) *plus the previous suggestion set itself*: the
path-dependence is deliberate, because incumbency is what the exit threshold and
show-tied grace are defined over. This is one careful step away from the playlist
layer's reconcile - a playlist's desired tracklist is memoryless, recomputed
identically no matter what was written before, while the suggestion set is
recomputed *given* its predecessor. A from-scratch rewrite would silently lose
hysteresis and grace.

The write is correspondingly not a blind replace. Invariant: **every existing
suggestion row is explicitly re-confirmed or deleted, each sync.** The retention
loop runs over candidates ∪ incumbents; an incumbent absent from the scoring output
(every supporting seed gone) is not "unknown", it is a zero - a loop over scored
candidates alone would leak orphaned rows forever. Survivors are updated in place
(evidence and weight refreshed, `created_at` preserved as "first suggested"), the
rest deleted, in one transaction. Removal handling therefore needs no per-cause
code:

- **A seed drops out of the user's top artists**: taste sync deletes its
  `lastfm_top_artist` row; on the next suggestion sync every path through that seed is
  gone, and any candidate that no longer clears the (exit) threshold or the cap loses
  its interest row. Suggestions justified by remaining seeds survive untouched.
- **The user excludes an artist**: dropped as seed and as candidate at the next
  recompute, plus deleted immediately by the exclusion write (above).
- **A suggested artist becomes known** (clears the playcount floor, or gets a loved
  track): the known-artist filter drops it and the known-kind row takes over
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

Two mechanisms close the loop, plus a deliberate line on what "known" means:

- **Playcount floors: presence is not knowing.** A `lastfm_top_artist` interest
  counts toward the known classification only when its weight (playcount) clears
  `KNOWN_PLAYCOUNT_FLOOR = 20`, and the overall-top-1000 blocklist applies the same
  floor (the response carries playcounts). Trace exposure - a few organic radio
  plays, a handful of passes through the playlist - no longer flips anyone to
  known. Loved tracks get no floor - loving a track is an explicit act, not
  scrobble residue.
- **Show-tied grace: becoming known never evicts mid-decision.** An incumbent
  suggestion whose artist still has an upcoming matched show is not pruned for
  *becoming known*; that re-evaluation waits until the show has passed. The plays a
  playlist generates never touch a suggestion's score (they move the known
  classification, not the seed-similarity paths), so this one clause is the whole
  scrobble-loop protection - and a user who plays a suggested artist forty times
  before the gig is the success case, not cleanup. Grace excuses known-ness and
  nothing else: score thresholds always apply, so a suggestion whose support
  genuinely collapses (a seed excluded, or taste that actually moved) leaves the
  playlist even mid-window - with no live evidence behind it, serving it is inertia,
  not conviction. Score *noise* is hysteresis's job, not grace's. (Exclusion of the
  artist itself always wins - "ignore this artist" takes effect immediately.) Graced
  incumbents still count against `SUGGESTION_BUDGET`. Mechanics: grace retains,
  never admits - the graced set is computed over incumbents only, one local query
  for an upcoming show within `EVENT_MATCH_RADIUS_KM` of any of the user's playlist
  target cities (`users.city_id` plus pinned cities), the same servable predicate
  the match join runs on. Deliberately *not* "any upcoming show anywhere" (touring
  artists always have a future date somewhere, so grace would become permanent) and
  *not* playlist membership (cap shuffles and resolution failures would feed the
  playlist's own output back into its input and churn). Un-gracing is lazy: once
  the show passes, is canceled, or the user moves cities, the next recompute's
  query simply stops returning the artist - no scheduler, no stored state.

Above the floor, plays count no matter who caused them: **known measures
familiarity, not provenance**. A user who has heard an artist twenty times knows
that artist, and whether our playlist did it changes nothing about what discovery
means for them - an artist showcased for a whole show window who earned no loved
track and no listening beyond the playlist had a fair shot, and re-suggesting them
next tour is repetition, not recall. The floor plus grace also give the loop a
benign shape: plays accumulated during a show window can only reclassify the artist
after the window closes, and the 12-month kind decays on its own - an artist looped
for one season and then dropped falls back out of the list. (The overall-period
blocklist deliberately remembers longer: a lifetime listening history is not a
discovery, however old.)

The rejected alternative was provenance accounting: record which titles each
playlist served per user and subtract the user's plays of exactly those titles
(`track.getInfo` takes a `username` and returns `userplaycount`) before comparing
to the floor. Implementable and precise, but it buys the wrong thing: it re-suggests
artists the user has demonstrably heard plenty of, contradicting the familiarity
definition (including its worst case - a user who adores exactly the served tracks
would read as "organic zero, keep suggesting"), and it costs a permanent
serve-history table plus per-artist API calls on unverified endpoint behavior.
Revisit only if calibration shows passive playlist listening polluting the known
set faster than the floor tolerates.

One structural note: the match join never re-derives known-ness. The classification
nuance (weight floors, the show-grace window) lives in suggestion sync alone, which
maintains the disjointness invariant - pruning for known-ness only once out of
grace, alongside its ordinary score-based pruning - while the match join filters by
kind sets and exclusions.
Between syncs a freshly-adopted artist can linger in a suggested-only playlist until
the next suggestion sync; harmless lag, resolved by the same recompute that admits
it.

## The "include artists I know" setting

`users.include_known_artists`, boolean, default **false**: playlists contain only
suggested artists unless the user opts known artists in.

- **Semantics when false**: only suggested artists qualify for matching -
  implemented as "has a suggested-kind interest", full stop. The join does not
  re-check known-ness: the classification nuance (floors, show-grace) lives in
  suggestion sync alone, so the join trusts the disjointness invariant it maintains.
  A freshly-adopted artist can linger one suggestion-sync cycle in a suggested-only
  playlist - a user hearing an artist they just started loving is a benign failure.
  When true: known and suggested artists both qualify. Exclusions filter regardless
  of the setting.
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

## Playlist layer tweak: three tracks per artist, regardless of kind

`TOP_TRACKS_PER_ARTIST` drops from 5 to 3, uniformly - the per-kind weighting the
earlier plans reserved space for is deliberately not taken. The core surface is the
suggested-only playlist (the setting's default), where breadth wins: an artist's
three best tracks answer "do I like this, is the show worth it?" about as well as
five, and the 100-track cap then covers ~33 artists' shows instead of 20. The
known-artists mode earns no extra depth either - its value is knowing your artists
are in town, not proving with five tracks what the user already knows they like. A
uniform count also deletes complexity: no per-kind branch in the desired-state
computation, and an artist briefly holding both row types (the grace window, sync
lag) needs no adjudication at all. The 5 -> 3 change applies to existing playlists
at rollout. Ordering, dedupe, provenance, and the full-replace write are untouched.

## Volume and rate limits

Per user, steady state: up to ~200 `getSimilar` calls per 30 days - one per eligible
seed, bounded by the top-artists fetch itself, and usually far fewer (the affinity
eligibility bar trims the tail, and seeds shared across users share edges) - one
`getTopArtists(overall)` call per suggestion sync, and up to `SUGGESTION_BUDGET`
suggested artists joining the 24h-TTL Bandsintown rotation - the standing commitment
the event plan flagged, bounded exactly as it prescribed. Suggested artists that match a show enter Spotify resolution and
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
`user_artist_exclusions`, and `user_artist_interests.weight` (backfilled from
evidence). Taste sync starts writing weights for its kinds.
`LastfmClient.get_similar_artists(name, limit)` in the existing style, with
not-found handled like `get_artist_top_tracks`.

**Phase 2 - suggestion sync.** `app/suggestion_sync.py` (seeds, freshness-gated edge
fetch, scoring, selection with hysteresis, known-classification floors, show-tied
retention of incumbents, interest replacement, exclusion enforcement),
`POST /users/{id}/suggestions/sync` returning a sync-result schema in the
established shape (seeds synced/skipped, candidates scored, suggestions
created/kept/removed). Ends with the calibration run against a real account.

**Phase 3 - the setting + match integration.** Consolidate the match join into
`matching.py` with kind and exclusion filters; wire it into the events endpoint
(override param) and playlist desired state; `TOP_TRACKS_PER_ARTIST` 5 -> 3;
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
- Match-score distribution across popularity tiers, to seat the enter/exit thresholds.
