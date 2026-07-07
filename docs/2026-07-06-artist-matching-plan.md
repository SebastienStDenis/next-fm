# Artist matching design (hypothetical, work in progress)

*Written 2026-07-06 by Claude (Fable 5).*

> **Status: exploratory notes, not a decision.** This summarizes a design discussion
> about how to score whether a user would like an event artist. Nothing here is
> committed to; numbers and API behaviors should be verified empirically before
> building.

The problem: given a user's taste (their linked artists and interest signals) and an
artist playing an upcoming show near them, produce a score for how likely the user is
to enjoy that artist. Exact matches (the event artist is already in the user's interest
set) are the trivial top tier; this doc is about everything below that.

## Two candidate signals

**Collaborative similarity (primary candidate).** "People who like X also like Y",
derived from co-listening data. This is the signal that actually predicts taste, and
Last.fm precomputes it for free: `artist.getSimilar` takes one artist and returns up to
~250 similar artists, each with a 0-1 match score, sorted descending. We already have
the `LastfmClient` and the canonical artist registry this would feed.

**Content-based similarity (fallback candidate).** Embed reproducible text built from
authoritative tags and descriptions per artist, and compare vectors. Deterministic,
works with zero listener overlap, and degrades gracefully. But text embeddings measure
*genre* similarity, not *taste* similarity: two bands with near-identical tags can have
disjoint audiences, and the text cannot see that. Also, Last.fm tags are noisy ("seen
live" is the most common tag on the site) and bios are thin or absent exactly for the
long-tail acts a concert product cares about.

Working hypothesis: collaborative similarity is the primary signal; content-based is
the backstop for artists with no listening data. Not the other way around.

## The similarity graph

Artists are nodes; every row of a stored `getSimilar` response is a weighted edge.
Scoring never traverses this graph. Both endpoints are known before scoring starts (the
user's interest set on one side, the event artist on the other), so the question is
only whether an edge connects the two sets and how heavy it is. That is a join, not a
walk:

```sql
SELECT ui.artist_id, sim.match
FROM user_artist_interests ui
JOIN artist_similarities sim ON sim.similar_artist_id = ui.artist_id
WHERE sim.artist_id = :event_artist_id
```

**Fetch direction: per event artist, at event-ingestion time.** One call per event
artist, cached in a table with a `last_synced_at` like `lastfm_artists`. This wins on
two axes:

- Economics: one event artist's similar list serves every user in that city. Fetching
  per user artist instead would re-fetch lists for popular artists thousands of users
  share.
- Tail coverage: a niche artist's similar list is built from what their few listeners
  *also* play, which skews toward the bigger names in their scene - exactly what user
  interest sets contain. The reverse edge (a niche act appearing in a big artist's top
  250) would never survive truncation.

All API calls happen during ingestion and land in a table; scoring is a join against
cached edges, zero network.

## Scoring

For each edge connecting a user artist to the event artist:

```
path_score = match(user_artist, event_artist) * affinity(user, user_artist)
score(event_artist) = max over all paths
```

- `match` comes from the stored similar-artists edge.
- `affinity` comes from `UserArtistInterest` evidence: rank or playcount (log playcount
  or 1/rank as a first cut), boosted when the artist also appears in loved tracks.
- **Max, not mean.** Averaging over the whole interest set punishes eclectic taste
  (everything scores 0.6). A user who loves one doom metal band should get the doom
  metal show even if their other 200 artists are folk. One strong path is a better
  predictor than many weak ones.
- Possible refinement if plain max feels off: sum the top 3 paths with decaying
  weights, or `max + small_bonus * count(other decent paths)`, to reward consensus when
  ten artists all connect at 0.5. Ship plain max first.

## Why the top-250 truncation is acceptable

The cap truncates in the direction that hurts least, given per-event-artist fetching:

- The edge that matters (small event artist -> popular user artist) sits comfortably
  inside the event artist's top 250, because their list is dominated by the bigger
  artists their fans came from.
- Edges below position 250 are by construction the weakest in the list; a match that
  cannot crack an artist's top 250 neighbors would not clear a recommendation threshold
  anyway. Truncation acts like the weak-edge cutoff we would apply ourselves.
- If recall ever needs a boost, edges from both directions can be unioned (event
  artists' lists plus any user artists' lists already fetched). An optimization to
  reach for only if misses are observed.

## Why "mostly zero scores" is expected and mostly correct

The intersection between a user's set and an event artist's list is not a random draw
from millions of artists. Both sets are samples from the same underlying distribution.
An artist's similar list is a portrait of what their own fans play most, at whatever
resolution the scene exists (mainstream indie's head for a mainstream act, a subscene's
shared reference points for a niche act). A user who would plausibly like the artist is
drawn from roughly the same fan population, so their top artists sample the same
distribution. Within a shared genre, collisions are near-guaranteed, not lucky.

When the event artist is outside all of the user's genres, the score is 0 - and that is
the system working. Most concerts in a city are irrelevant to any given user; the
product needs the 10-20 real matches a month, and a sparse-but-precise signal is the
right shape for filling a playlist.

Cases where a *wanted* match scores zero:

1. **No-audience artists** (a 40-listener opener): no co-listening data, empty or junk
   similar list. No list length fixes this; collaborative filtering fundamentally needs
   listeners. This is the content-based fallback's job - a tiny act usually still has a
   couple of genre tags when it has no similarity neighborhood.
2. **Contrarian listeners** whose sets deliberately avoid everything their scene
   shares. Rare, and hard for every recommendation method.
3. **Shallow profiles** (few scrobbles): thin interest set, everything is harder. Not a
   similarity-graph problem specifically.

## Recall lever: user-side profile expansion (deferred)

If real matches are observed scoring zero, expand the user side at taste-sync time: for
each user artist, add its similars into a materialized weighted profile
(`similar(user_artist) x affinity`). A 200-artist set becomes a few-thousand-artist
profile, and scoring stays a single join.

Be honest about what this is: two-hop reachability (user artist -> similar -> event
artist), computed meet-in-the-middle from two precomputed one-hop neighborhoods instead
of by runtime traversal. The traversal cost objection goes away; the signal dilution
one does not:

- A two-hop score should be `match1 * match2 * affinity` - two sub-1 factors, so it
  dilutes fast, and correctly so: "similar to something similar to what you like" is
  weaker evidence.
- Direct edges must dominate. Expanded hits are a recall backstop with a score ceiling,
  not a peer signal; a dense pile of weak two-hop paths must not outrank one strong
  direct edge.
- It roughly doubles the API-call surface (similar lists needed for user artists too),
  so it is not in the first build.

## Content-based fallback (deferred)

For artists with no usable similarity neighborhood: embed reproducible text built from
tags and descriptions, compare against the user's artists' vectors, aggregate with the
same max-style logic. Notes from the discussion:

- **No dedicated vector database.** Postgres 18 is already here; `pgvector` gives
  cosine search in place, and at this scale (thousands to low hundreds of thousands of
  artists, user sets of a few hundred vectors) even brute force is fast.
- Raw cosine similarities cluster in a narrow band and are not a likability score;
  calibration against ground truth (did the user add/play the track?) is needed and is
  blind at first.
- Source coverage for the long tail is the open question: Last.fm bios are
  inconsistent, MusicBrainz tags are sparse, and the acts that need the fallback most
  have the least text.

## Open questions

- Match-score normalization: `getSimilar` scores are normalized per list (the top entry
  is ~1.0 even when an artist's "most similar" is a stretch), so a 0.9 from a tiny
  artist's list is less trustworthy than a 0.9 from a big artist's. Damping by the
  event artist's listener count is a cheap correction if tiny-artist scores look
  inflated.
- Threshold calibration: where the "include in playlist" cutoff sits is empirical and
  needs real event data to tune.
- Hit-rate validation: before building, run the cheap experiment - take a real linked
  account's top artists and a sample of plausible event artists across popularity
  tiers, and measure how often the intersection is empty.
- Rate limits and storage: ~5 req/s community rate limit and the 100 MB stored-data cap
  from the ingestion plan apply to similar-artist edges too; edge tables for many event
  artists need to respect both.

## Rough phasing (if this direction is chosen)

1. Exact-match tier: event artist already in the user's interest set.
2. Direct edges: fetch `getSimilar` per event artist at ingestion, store edges, score
   with `max(match * affinity)`.
3. Only if observed misses warrant it: user-side profile expansion (two-hop, damped),
   then content-based fallback via pgvector for no-audience artists.
