# Background sync design (scheduled nightly re-sync)

*Written 2026-07-09 by Claude (Fable 5).*

Today a user's data refreshes only when they press the Sync button. This doc
designs the automatic background re-sync: which users get synced, in what
order, how often, what stops syncing for users who stop showing up, and how the
same design runs locally and in production (Render + Temporal Cloud). It is
Phase 3 of `docs/design/2026-07-08-production-deployment-plan.md` and makes concrete
the future-work sketch in `docs/design/2026-07-07-sync-orchestration-plan.md`.

The guiding constraint is deliberate modesty: the simplest design that is
production-idiomatic and on the path to the eventual scaled-up version. One
user syncs at a time, no throughput tuning, no new infrastructure - the
existing Temporal worker does everything, and the pieces that would change
under load are isolated so scaling later is a local edit, not a redesign.

## Decisions at a glance

| Question | Decision |
|----------|----------|
| How often | Daily, one schedule firing at 06:00 UTC |
| Who | Users with a linked Last.fm account, seen in the last 30 days |
| What counts as "seen" | Any authenticated request, tracked in a new `users.last_seen_at` |
| Skip fresh users | Yes - skip anyone synced in the last 20 hours |
| Order | Oldest `last_synced_at` first, never-synced first of all |
| Concurrency | One user at a time (dispatcher awaits each sync before starting the next) |
| Manual vs scheduled collisions | Same workflow ID as the button; whichever is in flight wins |
| Inactive users | Derived from `last_seen_at`; no flag column, nothing to un-set when they return |
| Settings changes | Do not trigger a re-sync; picked up by the next nightly run or the button |
| New infrastructure | None - a Temporal Schedule executed by the existing worker |

## The shape

One new Temporal Schedule fires one new workflow once a day. Everything it
touches already exists:

```
Temporal Schedule "nightly-sync" (daily 06:00 UTC)
        │ fires (overlap policy: skip)
        ▼
DispatchSyncsWorkflow
        │
        ├─ activity list_users_due_for_sync ──► Postgres (eligibility + ordering)
        │
        └─ for each user id, strictly in order:
              child SyncUserWorkflow, id "user-sync-{user_id}"
              (the exact workflow the Sync button starts today)
```

The dispatcher runs on the same task queue and the same worker as everything
else. Locally that is the compose `worker` container against the Temporal dev
server; on Render it is the existing Background Worker against Temporal Cloud.
Nothing new is deployed anywhere - the entire feature is backend code plus two
columns.

## Who gets synced: eligibility

A user is due for a sync when all four hold:

1. **They have a linked Last.fm account.** Without one the workflow fails on
   step 1 by design; the dispatcher should not start runs it knows are doomed,
   mirroring the validation `POST /me/sync` does before starting a manual run.
2. **They have a home city set.** The pipeline is all-or-nothing: without a
   city there is no playlist to build, so nothing starts a partial run - the
   manual endpoint rejects it, the dispatcher never lists the user, and step 1
   fails fast if a run begins anyway.
3. **They were seen in the last 30 days** (`last_seen_at >= now() - 30 days`).
   See "Tracking activity" below.
4. **They were not synced in the last 20 hours**
   (`last_synced_at IS NULL OR last_synced_at < now() - 20 hours`).

This is one SQL query in the `list_users_due_for_sync` activity, ordered by
`last_synced_at ASC NULLS FIRST` - stalest first, and users who have never had
a successful sync ahead of everyone.

### Why skip recently-synced users at all

The alternative - queue every active user every night regardless of manual
syncs - is simpler by one WHERE clause, and the sync pipeline is idempotent
and internally TTL-gated, so re-running a fresh user is safe. But it is not
free: even a warm run hits Last.fm, may hit Spotify, and rewrites playlists.
Someone who pressed Sync at 11pm gets nothing from a 6am re-run except
third-party API churn. The skip is cheap, polite to the APIs we depend on, and
makes manual syncs count toward the daily cadence, which matches user
intuition ("I just synced, it's fresh").

### Why 20 hours and not 24

A 24-hour threshold against a 24-hour cadence self-defeats: last night's
scheduled sync finished at 06:04, tonight's dispatcher runs at 06:00, sees a
sync 23h56m old, skips - and the user silently drifts to an every-other-day
cadence. The threshold must sit comfortably below the cadence. 20 hours means
"synced since yesterday evening", which is the intent.

### Why oldest-first

The user's own framing - oldest last sync first - is right, and
`NULLS FIRST` extends it naturally: a never-synced user (signed up, linked
Last.fm, never pressed the button, or every run so far failed) is the stalest
possible and goes first. A failed run does not stamp `last_synced_at` (see
below), so failing users stay at the front of the queue and get retried once
per night - self-correcting, bounded, no extra retry machinery.

## Tracking activity: `users.last_seen_at`

The 30-day activity window needs a signal for "the user still uses the site".

**Not** Supabase's `auth.users.last_sign_in_at`, even though it is sitting in
the same database. It only updates on an explicit credential sign-in, and our
frontend keeps sessions alive indefinitely by silently rotating refresh tokens
(`@supabase/ssr` in the proxy, `docs/design/2026-07-08-auth-plan.md`) - a user who
visits daily might not "sign in" for months and would read as inactive.
Reaching into another service's schema is also coupling we do not need.

Instead, a new nullable `users.last_seen_at` (timestamptz), stamped by our own
auth dependency: `get_current_user` (`backend/app/auth.py`) already resolves
every authenticated request to a `User` row, so it updates the column when it
is null or older than one hour. The one-hour throttle keeps it to at most one
extra UPDATE per user per hour instead of one per request; nothing needs
minute precision from this column. JIT provisioning sets it at row creation.

The migration backfills `last_seen_at = now()` for rows that have a
`supabase_user_id`, so existing users do not drop out of the nightly sync
until their next visit. Pre-auth rows (`supabase_user_id IS NULL`) stay null
and are never eligible, which is correct - they are unreachable dead weight.

### Why 30 days, and why no `active` flag

Thirty days matches the product: concert discovery a month stale serves
nobody, and syncing an abandoned account burns Last.fm/Bandsintown/Spotify
quota to rewrite playlists nobody opens. The number is a constant in the
eligibility query, trivially tunable.

Deriving activity from `last_seen_at` beats the boolean `active` flag the
earlier docs sketched: a flag needs something to set it false (a janitor job)
and something to set it true again (login hook), and it can be wrong in both
directions. The timestamp is written in one place and the definition of
"active" lives in one query. When a lapsed user returns, their first request
stamps `last_seen_at` and the next nightly dispatch simply includes them
again - and the Sync button works for them the whole time regardless.

One accepted consequence: an inactive user's playlists freeze rather than
empty out. Concerts in them pass; stale events are only pruned by a sync. That
is fine to leave - the playlist decays gracefully, and their first sync back
cleans it up. Flagged as a follow-up if it ever grates.

## Recording syncs: `users.last_synced_at`

The freshness skip and the ordering both need "when did this user last
complete a sync". New nullable `users.last_synced_at` (timestamptz), stamped
by a small fifth activity (`record_sync_completed`) appended to
`SyncUserWorkflow` after the playlists step:

- It runs for **every** run - manual and scheduled share the workflow - so a
  manual afternoon sync correctly suppresses that night's scheduled one.
- It runs only when all four steps succeeded. A failed run leaves the stamp
  untouched, keeping the user at the front of the next night's queue.
- It is not a step in the UI checklist (`STEP_SPECS` and the progress query
  are unchanged); it is bookkeeping, not a phase the user watches.

Why a column and not Temporal's own record (the account page already shows
"most recent sync" via `describe()`)? Because eligibility is a bulk query -
"all users whose last sync is older than X, sorted" - and that is what a
database is for. Interrogating Temporal per user from the dispatcher would be
slower, rate-limited, and bounded by namespace retention (24h on the local dev
server). Temporal remains the source of truth for *run state*; the column is a
materialized "last success" fact about the user.

## The dispatcher workflow

`DispatchSyncsWorkflow`, alongside `SyncUserWorkflow` in
`backend/app/sync_workflow.py`. It does two things:

1. Execute `list_users_due_for_sync` (a normal activity in
   `sync_activities.py`; opens a session, runs the eligibility query, returns
   an ordered list of user id strings).
2. Loop over the ids **sequentially**, starting each as a child
   `SyncUserWorkflow` with the same workflow ID the button uses
   (`user-sync-{user_id}`) and awaiting its result before moving on. Failures
   are caught and counted, never propagated - one user's broken Last.fm link
   must not stall the fleet. The workflow returns a small summary
   (dispatched / succeeded / failed / skipped-already-running) that shows up
   in the Temporal UI.

### One user at a time - and why that is not a dead end

Sequential dispatch is the whole concurrency story, and it is enough for the
current scale by straightforward arithmetic: a warm sync (all the internal
TTL caches populated) takes low single-digit minutes, so even 50 active users
fit in a few-hour overnight window. The failure mode when the user base
outgrows this is soft - the nightly run takes longer, and if it blows past 24
hours the schedule's skip policy just skips a night - visible in the Temporal
UI long before it hurts.

It is also on the path to the final design, not a detour. The queue-everything
alternative the user-facing framing suggests (start all children, let the
worker drain them) is the same code minus the `await`; the graduation path is:

1. Bounded parallelism in the dispatcher (start N children at a time).
2. Worker tuning (`max_concurrent_activities`) to cap aggregate third-party
   API pressure.
3. The already-documented dedicated task queue for the playlist step, so the
   MusicBrainz 1 req/s throttle survives multiple worker replicas
   (`docs/design/2026-07-07-sync-orchestration-plan.md`, "Activities").

Every other piece of this design - eligibility query, ordering, the columns,
the schedule, the child-workflow relationship - survives all three steps
unchanged. Deliberately not doing any of them now.

(If the user count ever reaches thousands, the dispatcher loop also wants
`continue_as_new` to bound workflow history. Noted, nowhere close.)

### Collisions with manual syncs

The shared workflow ID makes both directions safe with zero locking:

- **Manual run in flight when the dispatcher reaches that user**: the child
  start fails with "workflow already started"; the dispatcher catches it,
  counts it as skipped, and moves on. The user is being synced right now
  anyway - the goal is met.
- **Scheduled run in flight when the user presses Sync**: `POST /me/sync`
  already starts with `USE_EXISTING` (`main.py`), so the button attaches
  to the running scheduled sync and the UI shows its live progress. From the
  user's perspective the button worked instantly.

## The schedule

One Temporal Schedule, ID `nightly-sync`, cron-style spec for 06:00 UTC daily,
action "start `DispatchSyncsWorkflow` on the `user-sync` task queue". Two
non-default knobs, both set explicitly:

- **Overlap policy: skip.** If yesterday's dispatch is somehow still running,
  do not stack another (this is Temporal's default; set it anyway so the
  intent is in code).
- **Catchup window: one hour.** The default is a year, which is wrong for us
  in both environments: locally, `docker compose up` after a weekend away
  would immediately fire the missed dispatches; a nightly refresh missed is a
  nightly refresh skipped, not a debt to repay.

### Why 06:00 UTC

Overnight (1-2am Eastern) for the initial audience, so playlists are fresh
when people wake up, and comfortably off-peak for the third-party APIs. One
fixed time for everyone; per-user-timezone scheduling is real complexity for a
product whose data changes daily at most, so it is explicitly out of scope.

### Why daily

Matches the slowest-moving upstream cache (the event TTL is already 24 hours
global), so more frequent runs would mostly no-op, and concert announcements
do not move faster than that. A user who wants fresher than daily has the
button.

### Where the schedule comes from

The worker creates it at startup: on boot (`app/worker.py`), after connecting,
`create_schedule` inside a try/except that ignores "already exists". The
schedule spec lives in code, versioned with the workflow it triggers, and
every environment self-provisions - no dashboard clicking on Temporal Cloud,
no README step for local dev, and dev/prod parity for free.

The worker rather than the api because the schedule targets the worker's task
queue and is meaningless without a worker running; the api can stay ignorant
of scheduling. The trade-off of create-if-missing is that *changing* the spec
(say, moving the hour) is not automatically applied to an existing schedule;
at our scale that is a one-off `temporal schedule update` or delete-and-let-
the-worker-recreate, acceptable until proven otherwise.

### Settings changes do not reschedule anything

Changing city, exclusions, or the known-artists toggle takes effect on the
next sync, whichever comes first: that night's scheduled run or the user
pressing the button (the UI already encourages a sync after settings
changes). No event-driven re-sync, no invalidation logic. The 20-hour skip
means a user who synced this afternoon and then changed city tonight waits
until tomorrow night unless they press the button - and the button is right
there.

## Running it locally

Nothing new to start. `supabase start` + `docker compose up` already run the
Temporal dev server and the worker; on boot the worker creates the
`nightly-sync` schedule in the dev server (SQLite-persisted, so it survives
restarts). It fires at 06:00 UTC only if the stack happens to be up, and the
one-hour catchup window means missed nights while the laptop is closed are
simply skipped.

For development you never wait for 06:00:

```sh
temporal schedule trigger --schedule-id nightly-sync   # fire the dispatcher now
temporal schedule describe --schedule-id nightly-sync  # inspect spec + recent runs
```

plus the Temporal UI on :8080, where the dispatcher run and its child syncs
are all visible. The dispatch behavior is identical to production because it
is the same code on the same primitives - the parity bar this project holds
everywhere else.

## Running it in production (Render + Temporal Cloud)

No changes to `render.yaml`, no new Render services, no cron. The pieces map
onto what Phase 1 already deployed:

- The **schedule** lives in the Temporal Cloud namespace, created by the
  Render worker on its first boot after this feature deploys.
- The **dispatcher and every child sync** execute on the existing Background
  Worker - the always-on service we already pay for, which was sized for
  exactly this (`docs/design/2026-07-08-production-deployment-plan.md`, "Background
  sync cadence").
- The **two columns** arrive via the Alembic migration in Render's pre-deploy
  step, like any other migration.

Cost delta: effectively zero. A scheduled dispatch is a handful of Temporal
Actions plus ~15-25 per user synced; fifty users nightly is a few percent of
the plan's included allowance. Render and Supabase are unaffected.

The rejected alternative - a Render Cron Job hitting an API endpoint or
running a script - would be a third service to configure, a second scheduling
system to reason about, and would still need all the same eligibility and
dedup logic, minus the durability, visibility, and dev/prod parity the
Temporal Schedule gets for free on infrastructure we already run.

## Schema changes

Two nullable columns on `users`, one autogenerated migration:

```python
last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

plus a hand-added backfill in the same revision
(`UPDATE users SET last_seen_at = now() WHERE supabase_user_id IS NOT NULL`).
No index yet: the eligibility query scans `users`, and the user count is
nowhere near making that matter.

## Implementation checklist

Each lands as its own PR, app fully working after each.

1. **Columns + stamping.** The two model fields, the migration with backfill,
   `last_seen_at` stamping in `get_current_user` (and at JIT creation), the
   `record_sync_completed` activity appended to `SyncUserWorkflow`. Verify: a
   manual sync stamps `last_synced_at`; browsing stamps `last_seen_at` at most
   hourly.
2. **Dispatcher.** `list_users_due_for_sync` activity,
   `DispatchSyncsWorkflow`, tests against the time-skipping test server
   (mocked activities; assert ordering, failure isolation, and the
   already-running skip) plus unit tests for the eligibility query.
3. **Schedule bootstrap.** Create-if-missing in `worker.py`; verify locally
   with `temporal schedule trigger` end to end.
4. **Docs.** Root `CLAUDE.md` module descriptions (`sync_workflow.py`,
   `sync_activities.py`, `worker.py`, `auth.py`); update the status note in
   `docs/design/2026-07-07-sync-orchestration-plan.md` to point here.

## Follow-ups (explicitly out of scope)

- **User-facing control**: an "automatic sync" opt-out toggle, or surfacing
  "next scheduled sync" in the account page. V1 ships without asking.
- **Cleaning up lapsed users' playlists** (empty or annotate them after N
  months inactive) rather than letting them freeze.
- **Throughput**: the three-step graduation path above, when nightly runtime
  or third-party rate limits demand it.
- **Notifying users** when a nightly sync lands new concerts (email digest) -
  a product feature that happens to be trivial to hang off the dispatcher
  later.
