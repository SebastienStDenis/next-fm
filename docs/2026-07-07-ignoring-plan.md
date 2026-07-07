# Ignoring design

*Written 2026-07-07 by Claude (Fable 5).*

What "ignore" should mean in this system and which ignore surfaces to build. Three
candidates were on the table: ignore a known artist, ignore a suggested artist, and
ignore an individual live event. This doc evaluates all three against the existing
pipeline - in particular the suggestion engine's playcount floors, enter/exit
hysteresis, and show-tied grace from `docs/2026-07-06-artist-suggestions-plan.md` -
and commits to a direction.

## Terminology

"Ignore" is the user-facing verb; **exclusion** is the stored policy, matching the
existing `user_artist_exclusions` table. An ignore is always a *(user, thing)* pair,
never a property of the thing itself, exactly like the known/suggested
classifications.

## Recommendation: three surfaces, two mechanisms

- **Ignore a suggested artist** and **ignore a known artist** are the *same
  mechanism*: the existing artist exclusion ("never suggest, never seed, never
  match"), which the suggestions plan already designed, `matching.py` and
  `suggestion_sync.py` already enforce, and whose write path was deferred to that
  plan's Phase 4. What remains is shipping the endpoints and UI, plus being explicit
  about what excluding a *known* artist cascades into (below). Build first - it is
  mostly already built.
- **Ignore a live event** is the genuinely new mechanism: a `user_event_exclusions`
  table filtering individual shows out of servability. Build second. Its one subtle
  design point is keeping the match join and the suggestion engine's show-tied grace
  in agreement, which this doc pins down as an invariant.
- **No third mechanism.** A scoped or softer artist ignore ("hide their shows but
  keep them as a seed", "not this time") is deliberately not built; the rejected
  section explains why the two mechanisms above cover the real intents.

## The invariant everything hangs on

**Ignores are servability filters, never taste inputs.** An exclusion row changes
which rows the match join and the suggestion selector may *act on*; it never touches
scores, weights, affinities, playcount floors, or the known classification. Two
consequences, stated once here and relied on throughout:

1. **Hysteresis is unaffected by construction.** Enter/exit thresholds exist to damp
   score noise; ignores are not score events. Excluding an artist removes it from
   selection before thresholds matter, and ignoring an event changes no candidate's
   score at all. No new churn mode is introduced.
2. **Any new servability filter lands in the shared predicate, at one place.** Grace
   already promises to use "the same servable predicate the match join runs on"
   (`_graced_artist_ids`); if event ignores filtered the match join but not grace, a
   suggestion could be retained by a show that will never be served - and if they
   filtered grace but not the join, a served show could fail to protect its own
   suggestion. Both directions are bugs. The event-ignore filter therefore goes into
   a predicate shared by both call sites, not sprinkled per query.

## Ignoring artists: ship the existing exclusion

One table, one meaning, regardless of whether the artist is currently known or
suggested: *never act on this artist for me*. The enforcement already in place:

- `artist_qualifies` filters exclusions unconditionally, so both the events view and
  playlist desired state drop the artist's shows.
- Suggestion sync drops excluded artists as seeds and as candidates, and the
  exclusion check precedes the known/grace check in `select_suggestions` - exclusion
  beats grace, so "ignore this artist" takes effect at the next sync even
  mid-show-window, exactly as the suggestions plan specified.
- Floors are irrelevant to exclusions: a candidate is dropped for being excluded
  before known-ness (where floors live) is ever consulted.

What the write path adds, per classification:

### Ignoring a suggested artist (the primary case)

The core discovery-feedback action: "stop suggesting this". Per the suggestions
plan, creating the exclusion also immediately deletes any existing `similar_artist`
interest row for the pair - safe because the suggestion engine owns that kind and
would prune it next sync anyway. Effects cascade with no new code: the artist stops
being event-synced once no interest row remains (the fetch loop is interest-driven),
their events age out, and playlist reconciliation drops their tracks on the next
playlist sync. Grace never resists: exclusion always wins. The artist can never
re-enter selection while the exclusion stands, whatever their score does.

Un-ignoring deletes the exclusion row; the artist becomes an ordinary candidate
again and must clear `SUGGESTION_ENTER_SCORE` fresh (incumbency and `created_at`
were lost with the interest row). Correct: an un-ignored artist has no standing
claim to its old hysteresis advantage.

### Ignoring a known artist: full-strength, cascade included

The same exclusion row on a known artist does two things, and the second is the one
to be honest about:

1. **Their shows stop matching.** Only visible when `include_known_artists` is true
   (the non-default mode); under the default, known artists' shows never surface
   anyway.
2. **They stop seeding.** Every similarity path through them disappears from
   scoring, so at the next suggestion sync any suggestion that stood only on them
   fails the exit threshold and is pruned - upcoming shows notwithstanding, since
   grace never overrides score. Suggestions with independent support survive.

The cascade is a feature for its designed use case (purging taste contamination: a
shared account, a phase you're over) and a footgun for the softer intent "I love
Radiohead, I just don't need their show in my playlist - I already have tickets".
For that intent the right tool is ignoring the *event*, which the second mechanism
provides; the UI should present "ignore this show" alongside "ignore this artist" so
the sledgehammer is a choice, not the only option. With that escape hatch, one
full-strength artist exclusion is the right shape, and the recovery path is
tolerable: un-ignoring restores the paths, and formerly dependent suggestions
re-enter on the next sync if they still clear the enter threshold.

Two costs, accepted:

- **Excluded known artists keep their Bandsintown rotation.** Their known-kind
  interest rows are facts owned by taste sync and survive the exclusion, so event
  sync keeps fetching their feeds even though nothing will serve the results. This
  is the same "the event pipeline never asks why" cost the include-known setting
  already accepted; revisit only if excluded-artist volume ever shows up in
  Bandsintown quotas.
- **The seed skip is provably safe, exclusion or not.** Excluded seeds are dropped
  before the affinity-eligibility fetch gate, so no `getSimilar` calls are spent on
  them; nothing about floors or affinity computation changes, because excluded
  artists still count as known for classification (they are just never acted on).

### API surface

The suggestions plan's Phase 4 shape, unchanged:

```
PUT    /users/{user_id}/artists/{artist_id}/exclusion    204, idempotent
DELETE /users/{user_id}/artists/{artist_id}/exclusion    204, idempotent
```

The `PUT` handler also deletes the pair's `similar_artist` interest row in the same
transaction. `GET /users/{user_id}/artists` gains an `excluded: bool` per artist so
the UI can render and toggle the state; excluded artists stay in the listing (their
interest rows still exist and the user needs to see what they've ignored to undo
it).

## Ignoring events: the new mechanism

"Not interested in this show" - the artist is fine, this particular booking is not
(seen them already, wrong venue, out of town that weekend).

### Schema

Mirrors the artist exclusion exactly:

```
user_event_exclusions          -- user policy: never serve this show to this user
  id                 uuidv7 PK
  user_id            FK -> users.id (cascade)
  event_id           FK -> events.id (cascade, index)
  created_at
  unique (user_id, event_id)
```

Durable, owned by no sync, never pruned - the same lifecycle rationale as artist
exclusions. Rows for past events linger harmlessly (events themselves are kept past
`starts_at`); rows for canceled events are cascade-deleted with the event, which is
exactly right because the ignore is moot.

**Identity rides `events.id`, not the Bandsintown external id.** Event sync updates
events in place keyed by `bandsintown_events.external_id`, so the canonical UUID is
stable across refreshes and the ignore survives them. A rescheduled show (same
external id, new `starts_at`) keeps its ignore - "not interested in this show" is
about the booking, and re-surfacing it because the date moved would mostly re-serve
shows the user already declined. The one leak: a show that vanishes from the feed
and later reappears is a cancellation followed by a new event row, so the ignore is
lost. Rare, self-announcing (the show reappears in the playlist, one tap re-ignores
it), and the alternative - keying user policy to a source-specific external id -
would bake Bandsintown identity into a table that must outlive any single event
source. Accepted.

### Enforcement: one shared predicate

`matching.py` gains the filter next to the pieces it already owns:

```python
def event_not_ignored(user_id) -> ColumnElement[bool]:
    # NOT EXISTS (select 1 from user_event_exclusions where user_id, event_id)

def servable_event(user_id, cities) -> ColumnElement[bool]:
    return upcoming_event_near(cities) & event_not_ignored(user_id)
```

Three call sites:

- **`match_artist_shows`** uses `servable_event` in place of `upcoming_event_near`.
  Because the join then reduces to one soonest *surviving* show per artist, ignoring
  an artist's next show simply promotes their following non-ignored nearby show -
  the artist is untouched, only the booking is. Ignoring an event with several
  lineup artists hides it for all of them: the user declined the show, not a name on
  the bill.
- **`_graced_artist_ids`** uses `servable_event` too - this is the invariant from
  the top of the doc doing its work, and the interesting design decision; next
  section.
- **The events endpoint** (`GET /users/{user_id}/events`) applies
  `event_not_ignored` by default and gains `include_ignored: bool = false` plus an
  `ignored` flag per event, mirroring how `include_known_artists` already lets the
  UI show everything. The UI needs ignored events visible on demand to offer undo.

Playlist reconciliation needs nothing: desired state flows from
`match_artist_shows`, and the full-replace write drops the ignored show's tracks on
the next playlist sync, provenance and all.

### The grace interplay, decided

Should an ignored show still grace an incumbent suggestion that has become known?
No - grace counts only servable shows, so the filtered predicate is the correct one.
The reasoning, since this is the subtlest consequence in the doc:

Grace exists so that *becoming known never evicts mid-decision* - the plays a
suggested artist earns before their show must not strip them from the playlist
before the user decides on a ticket. Ignoring the show **is** the decision. Once the
user declines the booking, there is no pending decision left to protect, and the
match join (now filtered) will never serve that show again anyway - unfiltered grace
would retain a suggestion that serves nothing, burning a budget slot and a standing
Bandsintown commitment on pure inertia. Grace retains, never admits; retention with
nothing to serve is exactly the inertia the suggestions plan built grace to avoid
rewarding.

Walking the two incumbent cases through a sync after their only nearby show is
ignored:

- **Incumbent that has become known** (the graced case): grace lapses, the next
  suggestion sync prunes the suggestion for known-ness, the known-kind rows take
  over justifying the artist. This is the ordinary post-show outcome arriving early
  because the user ended the decision window themselves.
- **Incumbent still genuinely unknown**: nothing happens to the suggestion. It never
  needed grace - it stands on its score - so it survives selection, keeps its
  budget slot, and simply serves no tracks in that city until another show appears.
  A new booking (a different event row) serves normally with no un-ignore needed.

One accepted asymmetry falls out: un-ignoring a show after grace has lapsed does
*not* resurrect a pruned, now-known suggestion - grace retains, never admits, and
known-ness blocks re-entry. The user changing their mind about a show they
explicitly declined, *and* the artist having crossed the playcount floor in the
meantime, is a rare compound; the artist's shows remain reachable through
`include_known_artists`, and the alternative (grace counting ignored shows) would
make every ignored show extend retention pointlessly, the common case paying for the
rare one.

And restating the invariant's other half for the record: event ignores never touch
`known_artist_ids`, `seed_affinities`, the overall-top blocklist, candidate scores,
or thresholds. An ignored show changes what is *served*, never what is *believed*
about taste.

## Rejected and deferred

- **Scoped artist exclusion** (`shows` vs `all`, or separate exclude-from-matching /
  exclude-from-seeding flags). The `shows` scope is incoherent for suggested artists
  - a suggestion whose shows can never serve is a dead standing commitment, strictly
  worse than exclusion - so the scope would only ever apply to known artists inside
  the non-default include-known mode, an asymmetry that signals the axis is wrong.
  The real per-show intent is covered by event ignores. Revisit only if the
  known-artists mode gains real users who want durable per-artist show-hiding
  without touching seeding; the exclusion table can grow a scope column then without
  migration pain.
- **Snooze / "not this time"** (a suggestion suppression that expires on its own).
  Needs expiry machinery and a second lifecycle for a marginal intent gap: ignore is
  cheap to undo, and event ignores already expire naturally (they die with the
  show). Defer until users demonstrably hoard-then-regret exclusions.
- **Venue ignores** ("never show me anything at X"). A plausible future axis; it
  slots into the same `servable_event` predicate when wanted, which is exactly why
  the predicate is the extension point. Not built now.
- **Ignoring by deleting interest rows** - already rejected by the suggestions plan:
  source-owned rows are facts and the next sync recreates them; deletion cannot
  express "yes I listen to it, but don't act on it".
- **Track-level ignores.** Out of scope; noting the known behavior for honesty: the
  playlist write is a full replace, so a track the user deletes on the Spotify side
  reappears next sync. If this grates, it is a playlist-layer feature (a per-user
  track suppression consulted by `desired_tracks`), not part of this design.

## Phases

**Phase 1 - artist exclusion write path.** This is the suggestions plan's Phase 4,
pulled forward: `PUT`/`DELETE /users/{user_id}/artists/{artist_id}/exclusion` (the
`PUT` also deleting the pair's `similar_artist` row in-transaction), `excluded` on
the artists listing, frontend toggle. No migration - the table exists. Tests:
exclusion beats grace in `select_suggestions` (exists), the immediate interest-row
delete, endpoint idempotency.

**Phase 2 - event exclusions.** One migration (`user_event_exclusions`);
`event_not_ignored` and `servable_event` in `matching.py`, adopted by
`match_artist_shows` and `_graced_artist_ids`; the events endpoint filter,
`include_ignored` param, and `ignored` flag;
`PUT`/`DELETE /users/{user_id}/events/{event_id}/exclusion`. Tests: the match join
promotes the next non-ignored show; grace lapses when the only graced show is
ignored while a score-qualified incumbent survives; the events endpoint override.

**Phase 3 - frontend.** Ignore/undo affordances on the Concerts panel (per event)
and the artists view (per artist), with copy that distinguishes "ignore this show"
from "ignore this artist" so the artist-level cascade is chosen deliberately.
