# Investigating: 0 concerts showing for everyone

*Written 2026-08-02 by Claude (Sonnet 5).*

Issue: [#378](https://github.com/SebastienStDenis/next-fm/issues/378) - "NextFM
showing 0 concerts for everyone", including users who used to see plenty. This
is a read of the code only (no access to Sentry, Temporal Cloud, or Render logs
in this environment); it narrows down where to look and what to look for, not a
confirmed root cause. No code was changed.

## What "everyone, including users who used to work" rules out

A regression scoped to one query or one user's data would not explain a
simultaneous drop across the whole user base. That points away from
per-user state (a bad match, a bad city, a cleared interest list for one
account) and toward something shared: either a bug in shared code that
just started running, or a shared external dependency.

Two shared code paths were read end-to-end and look correct:

- **`backend/app/routers/events.py`** (`GET /me/events`) - joins
  `Event`/`EventArtist`/`Artist`, filters by `artist_qualifies` (interest
  kind + not excluded) and `distance_km <= radius_km`, orders by
  `starts_at`. Nothing here looks capable of zeroing every user's results;
  it would need the underlying `Event` rows or every user's
  `UserArtistInterest` rows to already be empty.
- **`backend/app/sync/matching.py`** (`artist_qualifies`,
  `match_artist_concerts`, `distance_km`) - same conclusion, no changed
  constant (`EVENT_MATCH_RADIUS_KM = 50.0`) or altered predicate that would
  explain a global zero.

The most recent commit visible in this checkout
(`aed2e77`, "style(dashboard): drop counts and tighten the panel gap",
#372) only touches frontend label/spacing code
(`frontend/src/app/dashboard/*`) - it removed a tab-label count, not any
data fetch or filter. It is very unlikely to be the cause.

That leaves the ingestion side: **something upstream of the `Event` table
not being populated (or being emptied) for everyone at once.**

## Most likely cause: Bandsintown ingestion, not a bug in this repo

Every concert comes from Bandsintown via
`backend/app/clients/bandsintown.py` and
`backend/app/sync/event_sync.py::sync_user_events`, run per user as the
"events" step of `SyncUserWorkflow`
(`backend/app/sync/sync_workflow.py`). Two failure shapes in that path
would present exactly as "0 concerts for everyone, including users who
used to see plenty":

### 1. Bandsintown access has broken (key revoked, quota/rate limit, endpoint change)

If every call to `BandsintownClient.get_artist_events` starts raising
`BandsintownApiError` (bad `app_id`, 429s, a 5xx, or the undocumented
`V3.1/` path prefix disappearing - flagged as a known risk in
`docs/design/2026-07-18-concert-venues.md`), `_fetch_artist_events`
(`event_sync.py:119`) returns `"failed"` for that artist. On a failed
fetch, `sync_user_events` deliberately does **not** prune existing events
(`event_sync.py:88-90`, "Only delete after a successful sync") and leaves
`last_synced_at` untouched so the next sync retries.

That means a Bandsintown outage does not zero out concerts instantly -
it stops new ones from being added and stops the TTL-based refresh
(`EVENT_SYNC_TTL = 24h`). Existing future events keep showing until their
`starts_at` passes with no replacement. If Bandsintown access has been
broken for long enough (days to weeks, depending on how far out shows
were originally listed), every previously-matched concert eventually
falls off the "upcoming" filter (`Event.starts_at > now`) with nothing
replacing it - which converges to zero **for every user**, matching "used
to show plenty" rather than an instant cutoff.

**Where to confirm:** Sentry, filtered to `BandsintownApiError` (per
`docs/operations.md`, upstream API errors report at WARNING and reach
Sentry). Also check the "events" step summaries in Temporal Cloud
(`Found N concerts`, `sync_activities.py` / `EventSyncResult`) for a
climbing `artists_failed` count and `events_total` trending to 0 over
recent nightly runs.

### 2. Bandsintown is reachable but silently returns unusable data

`BandsintownClient._parse_event` (`bandsintown.py:89`) drops any event
missing an id, a parseable `datetime`, `venue.name`, or venue
coordinates, logging a WARNING and returning `None` - by design, so a
partially-broken listing doesn't crash the sync. But if Bandsintown
changed its response shape so that a required field (most plausibly
`venue.latitude`/`venue.longitude` or `venue.name`) is now missing or
renamed on **every** listing, then for every artist: the fetch itself
still succeeds (`status == "synced"`), `_parse_event` returns `None` for
every event, and `sync_user_events` proceeds to `_prune_events`
(`event_sync.py:88-90`) - which runs precisely because the sync
"succeeded" and deletes every future event for that artist that isn't in
the (now empty) fetched set. Unlike scenario 1, this would zero out
concerts **immediately** on the next sync cycle for every artist that
gets re-synced (bounded by the 24h TTL and however fast the nightly
dispatch works through the user base), not gradually - which may fit
"showing 0" better if the drop was sudden rather than a slow decline.

**Where to confirm:** Render/Sentry logs for a spike in `"Dropped
Bandsintown event ... (missing ...)"` warnings
(`bandsintown.py:114`) naming the same missing field across many/all
artists, right around when the symptom started.

### Distinguishing the two

Both are "Bandsintown" failures, but they're operationally different and
worth telling apart before acting:

- Scenario 1 shows up as `BandsintownApiError` issues in Sentry and a
  climbing `artists_failed` in the events step summary.
- Scenario 2 shows up as no errors at all, just `synced` counts as usual
  plus a wall of "Dropped Bandsintown event" WARNING logs, and
  `events_removed` spiking in the events step summary
  (`EventSyncResult.events_removed`, `_summarize_events` in
  `sync_workflow.py`).

Either way, this is not a code bug in the matching/serving path - it is
either an access problem with the Bandsintown API (key, quota, or the
unversioned `V3.1/` path being pulled) or an upstream data-shape change,
and the fix lives in operator/API-access response
(`docs/operations.md`'s "Spotify refresh token expired" runbook is the
template for what a Bandsintown-equivalent runbook should look like -
none exists yet for Bandsintown specifically).

## Two smaller things worth ruling out alongside the above

- **`BANDSINTOWN_API_KEY` unset in production**: `backend/app/worker.py`
  (`REQUIRED_SETTINGS`, `main()`) refuses to start the worker at all if
  it's empty (`SystemExit`), so this would present as *nothing* syncing
  for anyone (playlists, suggestions, everything), not just concerts. Worth
  a quick check that the worker is actually up and polling, but it doesn't
  match a "concerts only" symptom.
- **Nightly dispatch not running**: `docs/operations.md` already flags
  this as a known gap ("A nightly schedule that stops firing alerts
  nobody"). If `DispatchSyncsWorkflow` stopped firing, users would stop
  getting fresh syncs (`list_users_due_for_sync` in
  `sync_activities.py`), which compounds scenario 1's decay - concerts
  would go stale and expire even faster with no manual syncs happening.
  Worth checking in Temporal Cloud regardless, since it's a known blind
  spot.

## Suggested next step

Check Sentry (`Explore -> Logs`/Issues) for the two signatures above
around the time this was first noticed, and pull one recent "events" step
summary from Temporal Cloud for an affected user to see
`artists_failed` vs `events_removed`. That will tell which of the two
scenarios (or something else entirely) is actually happening before any
code changes are made.
