# Sync orchestration on Postgres (replacing Temporal)

*Written 2026-08-16 by Claude (Fable 5).*

`docs/design/2026-07-07-sync-orchestration-plan.md` put the four-step sync
pipeline on Temporal, and `docs/design/2026-07-09-background-sync-plan.md`
added the nightly re-sync as a Temporal Schedule. Both work, but the workflow
they orchestrate is small: one user, four steps in a fixed order, a nightly
loop over due users. This doc replaces Temporal with a `sync_runs` table in
the app's own Postgres and a worker that polls it, keeping every user-visible
behaviour equal or better and removing one hosted dependency (Temporal Cloud),
one dev container, one SDK, and the workflow-sandbox rules.

Job history and in-flight runs are not migrated: there are no users yet, and
the pipeline is idempotent, so lost runs cost nothing. Linked accounts, home
cities, playlists, and every other user row are untouched.

## Status (2026-08-22): built, verified locally, not yet merged

The design below is implemented on branch `refactor/postgres-sync-queue`
(rebased on `main` past #381's Ticketmaster/RA change). Nothing is deployed;
no PR is open.

**Done.** Every section of the design below is implemented as written:
`sync_runs` table and migration (`01896934ac8c`, chained after
`1a7dd69c3a31`), `sync/sync_runs.py`, `sync/sync_pipeline.py`,
`sync/sync_steps.py`, the queue-serving `worker.py`, `routers/sync.py` on the
queue, `temporalio` dropped from `pyproject.toml` and `uv.lock`, and the
Temporal modules (`core/temporal.py`, `sync/sync_workflow.py`,
`sync/sync_activities.py`, `core/deps.py`'s `TemporalClientDep`) deleted.
Infrastructure and docs are cleaned: no Temporal in `docker-compose.yml`,
`scripts/run-local.sh`, `.env.example`, `README.md`, root `CLAUDE.md`,
`docs/operations.md`, or the frontend comments; the two July orchestration
design docs carry superseded banners.

**Review.** Code review found and fixed a shutdown race that could reopen a
terminal run: every fenced write now also requires `status = 'running'`, and
direct queue tests cover the terminal-safe requeue fence.

**Checks.** `ruff check`, `ruff format --check`, `ty check` and `pytest`
(285 passing) are green in `backend/`; `npm run lint` and `npm run build` are
green in `frontend/`.

**Verified end to end** against the local stack (`supabase start` plus
`API_PORT=8001 WEB_PORT=3001 docker compose -p nextfm-pgq up -d --build`),
driving the real UI:

- A manual sync from the settings card ran green through all four steps
  against the live upstreams - "Imported 718 artists", "Suggested 200 artists
  · 1 added, 1 removed", "Found 512 concerts · 55 added, 3 removed",
  "Generated 1 playlist · 6 tracks removed" - with the worker log showing the
  claim and `users.last_synced_at` stamped on completion.
- Reloading mid-run re-attached to the in-flight run and kept the progress
  ring moving (63% on the second load), which is the behaviour the Temporal
  `progress` query used to serve.
- After the run, the card collapsed to "Last synced ..." and its disclosure
  listed all four step summaries.
- Stopping the worker container mid-run and starting it again resumed the
  same row and skipped the already-completed steps.
- The failure path was exercised by an old test account whose Spotify
  playlist no longer exists on the bot account: the step retried three times,
  the run went `failed` with the later step left `pending`, `error` held
  `SpotifyApiError('Spotify error 404: Resource not found')`, and the user
  saw only "We couldn't update your Spotify playlists. Please try again."
  That is stale local test data, not a regression.

**Left to do.**

1. Open the PR and merge.
2. After deploy, remove the `TEMPORAL_*` variables from the Render `next-fm`
   env group and decommission the Temporal Cloud namespace. Unused settings
   are ignored, so this can happen any time after the merge.
3. Not verified locally, by nature: the nightly dispatch on a real schedule
   (`NIGHTLY_SYNC_ENABLED` is false locally) and two workers overlapping
   during a Render deploy. The schedule calculations have unit coverage and
   the queue uses a Postgres `SKIP LOCKED` claim, but both production events
   are worth watching - the worker logs "Nightly dispatch scheduled for ..."
   at startup and a "Nightly dispatch: N synced, ..." summary afterwards.

**Working notes for whoever picks this up.** The local stack needs
`supabase start` from the main checkout before compose. `sync_runs` is easiest
to inspect straight from psql (`select trigger, status, error, steps from
sync_runs order by created_at desc limit 5`); `docs/operations.md` has the
runbook version of that query. The worker is `docker compose logs -f worker`;
"Claimed sync run ..." is the line that proves the queue is being served.

## What Temporal does for us today (inventory)

Everything below must survive the move.

**Manual sync** (`POST /me/sync`, `backend/app/routers/sync.py`)
- Validates the linked Last.fm account and home city, then starts
  `SyncUserWorkflow` with id `user-sync-{user_id}` and `USE_EXISTING`, so a
  second click attaches to the running pipeline instead of starting another.
- 202 with the workflow id; 502 when the start RPC fails; 503 (from the
  dependency) when Temporal is unreachable.

**Status** (`GET /me/sync`)
- `status`: `none` (no run ever, or history aged out), `running`,
  `completed`, `failed`; `started_at`, `finished_at`.
- `steps`: four `SyncStepProgress` entries (`key`, `label`, `status`,
  `summary`, `finished_at`) - read through the `progress` query while
  running, from the workflow result once completed, from replay once failed;
  degrades to four pending steps when the query cannot be answered.

**Pipeline semantics** (`backend/app/sync/sync_workflow.py`, `sync_activities.py`)
- Steps run in order artists -> suggestions -> events -> playlists; each
  step is its own transaction (fresh session, commit at the end).
- Per-attempt timeouts 2 / 15 / 15 / 30 minutes; three attempts with
  exponential backoff (1s, x2, capped at 30s); `LastfmPrivateDataError` and
  `SpotifyAuthError` are non-retryable and carry their own user-facing text;
  anything else is masked with a per-step fallback message and logged at
  WARNING (Sentry).
- The first failing step marks the run failed; later steps stay `pending`.
- Timeouts log a warning naming the step and timeout kind (the only
  Sentry-visible trace of a timeout).
- On success, `users.last_synced_at` is stamped (the dashboard gate).
- API clients are owned by the worker process for its lifetime (MusicBrainz
  throttling stays global).

**Nightly re-sync** (`backend/app/worker.py`, `DispatchSyncsWorkflow`)
- A `nightly-sync` schedule fires daily at 06:00 UTC, overlap policy SKIP,
  1h catch-up window; created when `NIGHTLY_SYNC_ENABLED` is true and deleted
  otherwise, reconciled at worker startup.
- Dispatch lists due users (linked Last.fm, home city set, `last_synced_at`
  null or older than 20h; stalest first, never-synced first of all), runs each
  as a child workflow one at a time, counts a user whose manual run is in
  flight as skipped, and isolates one user's failure from the rest.
- Afterwards it drains the playlist tombstones then audits the bot account
  for orphaned playlists (each failure logged and retried next night); the
  counts land in the workflow result.

**Worker process**
- Long-running, reconnects with retry, restarts its poller on crash; holds
  the four API clients.

**Frontend** (`frontend/src/components/sync-card.tsx`, `sync-steps.tsx`,
`frontend/src/app/dashboard/page.tsx`, `lib/user-api.ts`)
- Fetches status on mount; polls `/api/me/sync` every 1.5s while `running`;
  re-attaches to an in-flight run after a refresh; shows the "taking longer
  than usual" notice 90s after the run's `started_at`; the "can't check
  progress" notice after 10 consecutive failed polls; the step playback
  settles then `router.refresh()`.
- Server-side, the dashboard reads status once to word empty lists ("run a
  sync" vs "the sync found nothing") from completed steps.
- Never reads the id returned by `POST /me/sync`.

**Infrastructure and docs**
- `docker-compose.yml`: `temporal` service + `temporal-data` volume,
  `TEMPORAL_*` env on api/worker, worker `depends_on: temporal`.
- `backend/render.yaml`: worker service (kept, command unchanged);
  Temporal Cloud connection lives in the Render env group.
- `scripts/run-local.sh` allocates Temporal ports; README, root `CLAUDE.md`,
  `.env.example`, `docs/operations.md`, and several design docs describe it.
- `temporalio` in `pyproject.toml`; `tests/app/sync/test_sync_orchestration.py`
  runs workflows on the Temporal time-skipping test server;
  `tests/app/test_worker_schedule.py` covers schedule reconciliation.

## Design

### The table

```
sync_runs
  id            uuid pk (uuidv7)
  user_id       uuid fk users(id) on delete cascade
  trigger       text   'manual' | 'nightly'
  status        text   'queued' | 'running' | 'completed' | 'failed'
  steps         jsonb  the four SyncStepProgress entries, exactly the API shape
  error         text   internal detail of the failure (ops only, never served)
  claim_id      uuid   set by the worker holding the run; the write fence
  heartbeat_at  timestamptz  bumped by the executing worker; stale => reclaimable
  created_at    timestamptz  enqueued (server clock, the ordering key)
  started_at    timestamptz  first claimed
  finished_at   timestamptz  terminal
  updated_at    timestamptz
```

Indexes:
- partial unique `(user_id) WHERE status IN ('queued', 'running')`: at most
  one active run per user. That single constraint is the whole dedup story -
  `INSERT ... ON CONFLICT DO NOTHING` either enqueues or tells the caller a
  run is already active, replacing `WorkflowIDConflictPolicy.USE_EXISTING`
  and `WorkflowAlreadyStartedError` in one place;
- partial `(created_at) WHERE status IN ('queued', 'running')` for the
  claim poll;
- `(user_id, created_at)` for the latest-run lookup.

Ordering uses `created_at` (server `now()`) rather than the id: manual rows
are inserted by the api host and nightly rows by the worker host, and only
the database clock is common to both.

`steps` is JSONB rather than a child table because the list is fixed-size,
always read and written whole, and its shape is owned by the API schema
(`SyncStepProgress`); it is dumped with `model_dump(mode="json")` on the way
in and `model_validate`d on the way out, always through `update()`
statements (never in-place mutation, which JSONB columns do not track).

### Modules

Temporal vocabulary (workflow, activity) goes away with the SDK:

| Today | After | Holds |
|---|---|---|
| `sync/sync_activities.py` | `sync/sync_steps.py` | `SyncSteps` (the four steps, cleanup, `list_users_due_for_sync`), `SyncStepError(message, retryable)`, `_user_facing_errors` |
| `sync/sync_workflow.py` | `sync/sync_pipeline.py` | `STEP_SPECS`, summaries, `pending_steps()`, `run_sync(run, steps)` (executes one claimed run), `dispatch_nightly_syncs(steps)` |
| - | `sync/sync_runs.py` | the queue: `enqueue_sync_run`, `claim_sync_run`, `latest_sync_run`, the fenced progress/heartbeat/finish writes, `sync_status_from_run` |
| `core/temporal.py` | deleted | |
| `core/deps.py` `TemporalClientDep` | deleted | |
| `worker.py` | `worker.py` | process assembly: clients, manual lanes, nightly scheduler, signal handling |

`SyncStepError` replaces `temporalio.exceptions.ApplicationError`: same two
fields (user-facing message, retryable flag), same raise sites.
`record_sync_completed` disappears: the `last_synced_at` stamp is written in
the same transaction that marks the run completed, so a completed run and
the dashboard gate can never disagree.

### The queue (`sync_runs.py`)

- `enqueue_sync_run(session, user_id, trigger) -> SyncRun`: insert
  `queued` with `pending_steps()`, `ON CONFLICT DO NOTHING RETURNING`; on
  conflict select the active run; if it finished in between, insert again
  (a two-line loop). Callers commit.
- `claim_sync_run(session) -> SyncRun | None`:
  `SELECT ... WHERE status = 'queued' OR (status = 'running' AND
  heartbeat_at < now() - STALE_AFTER) ORDER BY created_at FOR UPDATE SKIP
  LOCKED LIMIT 1`, then set `status = 'running'`, a fresh `claim_id`,
  `started_at` (if unset), `heartbeat_at = now()`. Reclaiming a stale run is
  the crash-recovery story: a worker that died mid-step leaves a `running`
  row whose heartbeat stops; the next claim picks it up, whatever its
  trigger. `FOR UPDATE SKIP LOCKED` keeps two lanes or two worker processes
  (deploy overlap on Render) from claiming the same row.
- `start_nightly_sync_run(session, user_id) -> SyncRun | None`: the
  nightly variant of enqueue - inserted already claimed (`running`, with a
  `claim_id`), `None` on conflict.
- The fenced writes - `record_step_progress`, `heartbeat_sync_run`,
  `finish_sync_run`, `requeue_sync_run` - are `UPDATE ... WHERE id = :id AND
  status = 'running' AND claim_id = :claim_id`; a zero rowcount means another
  worker reclaimed or finished the run and raises `SyncRunLost`, which cancels
  the step in flight (below). At most one worker ever writes an active run row,
  and shutdown cannot reopen a terminal run.
- `latest_sync_run(session, user_id) -> SyncRun | None`: newest by
  `created_at`.
- `sync_status_from_run(run) -> SyncStatusResult`: `queued`/`running` ->
  `running`, else as stored; `started_at` is the run's `created_at` (from
  the user's point of view the run began when they clicked, and that is what
  the 90s notice should measure); steps validated from JSONB.

`STALE_AFTER = 5 minutes`; the executor heartbeats every 30s. Recovery
latency matters far less than never running a live step twice, so the
window is generous - and still better than today, where a killed Temporal
worker left the activity running until its start-to-close timeout (up to 30
minutes) before retrying.

### The executor (`sync_pipeline.py::run_sync`)

Mirrors `SyncUserWorkflow.run`, minus the sandbox:

```
async with asyncio.TaskGroup() as tg:
    beat = tg.create_task(_heartbeat(run))          # every 30s, fenced
    try:
        for spec, step in zip(STEP_SPECS, run_steps):
            if step.status == "completed":          # resumed after a reclaim
                continue
            step.status = "running"; await record_step_progress(...)
            try:
                result = await _run_with_retries(spec, steps, user_id)
            except (SyncStepError, TimeoutError) as exc:
                step.status = "failed"; step.summary = user text; step.finished_at = now
                await finish_sync_run(..., status="failed", error=repr(cause))
                return
            step.status = "completed"; step.summary = spec.summarize(result)
            await record_step_progress(...)
        await finish_sync_run(..., status="completed")   # also stamps users.last_synced_at
    finally:
        beat.cancel()
```

- `_run_with_retries`: the whole loop runs under
  `asyncio.timeout(spec.attempt_timeout + RETRY_MARGIN)` (today's
  schedule-to-close) and each attempt under
  `asyncio.timeout(spec.attempt_timeout)` (start-to-close); up to
  `MAX_ATTEMPTS = 3`; a `SyncStepError(retryable=False)` ends the loop at
  once; other failures sleep `min(1s * 2**(n-1), 30s)` and retry. A
  `TimeoutError` logs "Sync step {key} timed out" at WARNING (parity with
  today's `_timeout_warning`) and surfaces the generic "didn't finish" text.
- Progress is persisted after every state change through a short session
  (`session_factory()`), so `GET /me/sync` reads live progress with no
  worker round-trip - strictly better than the query, which needed a worker
  to answer and could not answer for aged-out histories.
- Steps keep their own sessions and commits exactly as today; the run row is
  updated in separate short transactions, so a step's rollback never rolls
  back the progress bookkeeping and vice versa.
- If a fenced write reports the run lost, `SyncRunLost` propagates through
  the task group, which cancels whatever step is in flight (psycopg 3.2+
  cancels the server-side query cleanly); the lane logs it and moves on. If
  a progress write fails for any other reason (DB blip), `run_sync` raises
  and abandons the run without marking it failed: the row stays `running`,
  its heartbeat stops, and a later claim resumes it. A blip never fails a
  user's run.
- `asyncio.CancelledError` (worker shutdown - the worker installs a SIGTERM
  handler that cancels the main task, so Render stops, `docker compose
  stop`, and the dev `watchfiles` restart all take this path) makes a
  best-effort `requeue_sync_run` (`status = 'queued'`, claim cleared) then
  re-raises, so the next worker resumes the run within a second instead of
  after `STALE_AFTER`.
- Anything not caught above (a bug in the runner itself) marks the run
  failed with the generic message and is logged with `exception`, so no row
  can sit at `running` with a live heartbeat forever.

The step summaries, `pending_steps()`, and the user-facing fallback strings
move over unchanged.

### The nightly re-sync (`sync_pipeline.py::dispatch_nightly_syncs`)

```
for user_id in await steps.list_users_due_for_sync():     # stalest first
    run = start_nightly_sync_run(user_id)                # None => in flight, skipped
    if run: await run_sync(run, steps)                   # one at a time, failures isolated
drain = await steps.drain_playlist_tombstones()          # each guarded, logged on failure
found = await steps.audit_bot_playlists()
prune finished runs older than 30 days that have a newer sibling
log INFO "Nightly dispatch: synced N, failed F, skipped M, drained X (Y pending), audit found Z"
```

Runs are *not* pre-enqueued: a user's row appears only when their turn
comes, exactly like today's child workflows. Otherwise every due user would
read `running` (disabled button, "taking longer than usual" notice, blank
dashboard freshness markers) for however long the batch takes. The nightly
loop is the only place nightly rows are created; manual runs still start
immediately during the batch, as they do today, because they are served by
their own lanes.

The cleanup runs after the batch as today (drain before audit, so cleanup
happens even if the audit fails). What the dispatch used to return
(`DispatchSyncsResult`) is now the log line plus the `sync_runs` rows
themselves (`trigger = 'nightly'`, per-run status).

**Scheduling.** The worker computes the next 06:00 UTC, sleeps until then,
dispatches, repeats. On startup it dispatches immediately when it is inside
the catch-up window (06:00-07:00 UTC) - the same 1h catch-up Temporal gave a
restarting server. Re-dispatching after a mid-batch restart is naturally
idempotent: users synced already are no longer due, the user interrupted
mid-run conflicts (their row is reclaimed by a manual lane once stale, or
was requeued on graceful shutdown), and a re-run cleanup is harmless (the
drainer treats a Spotify 404 as settled; audit inserts are
`ON CONFLICT DO NOTHING`). The same reasoning covers two worker processes
alive at 06:00 during a deploy overlap: their batches interleave through
the per-user conflict and nothing runs twice for the same user.
`NIGHTLY_SYNC_ENABLED` gates the scheduler task; there is no schedule object
to create or delete any more, so nothing to reconcile.

### The worker

```
async def main():
    steps = SyncSteps(lastfm, bandsintown, spotify, musicbrainz)
    loop.add_signal_handler(SIGTERM, current_task.cancel)
    async with asyncio.TaskGroup() as tg:
        for _ in range(MANUAL_LANES): tg.create_task(_serve_runs(steps))
        if settings.nightly_sync_enabled: tg.create_task(_run_nightly_schedule(steps))
```

`_serve_runs` loops: claim (own session, commit); if nothing, sleep
`CLAIM_POLL_SECONDS = 1`; else `run_sync`. A lane that hits an unexpected
error (database unreachable, table not migrated yet on a fresh deploy) logs
it and sleeps `CRASH_RETRY_SECONDS = 5` before polling again - today's
crash-restart cadence, and not a Sentry event per second. `MANUAL_LANES =
2`: two users clicking Sync at once both start right away (as under
Temporal's concurrent activity execution) while bounding how many syncs
share the process's throttled clients; a third waits at most one run.
`SKIP LOCKED` makes lanes and overlapping worker processes safe by
construction. Polling (not `LISTEN/NOTIFY`) because production Postgres
sits behind the Supabase pooler; one cheap indexed query per lane per
second is nothing.

Connections: at peak each lane holds one step session plus one short-lived
heartbeat or progress session, and the nightly loop the same - about six
concurrent connections, within the engine's default pool and the pooler
budget noted in `docs/operations.md`.

Startup keeps the settings check and the client lifecycle; the Temporal
connect-with-retry goes away (the DB engine already connects lazily and
lanes log-and-retry on transient DB errors).

### API

`POST /me/sync`: same validation; `enqueue_sync_run(session, user.id,
"manual")`, commit, 202 `SyncStartResult(run_id, status="running")`. The
502/503 branches vanish with the RPC. `SyncStartResult.workflow_id` becomes
`run_id`; the frontend never read it.

`GET /me/sync`: `latest_sync_run` -> `sync_status_from_run`, or
`SyncStatusResult(status="none", steps=pending_steps())`. One indexed query;
no 502 branch, no best-effort degradation - the steps are always there.

`SyncStatusResult` and `SyncStepProgress` are unchanged, so the frontend
contract is unchanged. `SyncRunResult`, `DispatchSyncsResult` and the
"defaulted so Temporal can replay" comments in `schemas.py` go;
`TombstoneDrainResult` stays (the drainer returns it).

### Frontend

No behavioural change. Three comments mention Temporal
(`sync-card.tsx`, `user-api.ts`, `dashboard/page.tsx`) and are reworded.
The card's poll-failure handling stays (it protects against network blips,
not just Temporal).

### Infrastructure, config, docs

- `docker-compose.yml`: drop the `temporal` service and volume and the
  `TEMPORAL_*` env; the worker's `depends_on` moves to `api` (which applies
  migrations at startup) so a fresh stack orders itself sensibly.
- `backend/render.yaml`: unchanged shape (comment reworded); the operator
  removes `TEMPORAL_*` from the Render env group after deploy (unused
  settings are ignored, so order does not matter).
- `Settings`: drop `temporal_*`; keep `nightly_sync_enabled`.
- `.env.example`, `README.md`, root `CLAUDE.md`, `scripts/run-local.sh`
  (no Temporal ports / UI line), `core/accounts.py` docstring,
  `docs/operations.md` (failed-sync runbook now: Sentry names the
  exception, `sync_runs` has the run - `select trigger, status, steps,
  error from sync_runs where user_id = ... order by created_at desc`;
  nightly stops firing: check the worker log for the dispatch line;
  connection budget note).
- `pyproject.toml`: remove `temporalio`, `uv lock`.
- The July design docs that describe Temporal
  (`2026-07-07-sync-orchestration-plan.md`, `2026-07-09-background-sync-plan.md`,
  `2026-07-10-playlist-deletion-plan.md`, `2026-07-08-auth-plan.md`,
  `2026-07-08-phase-1-deploy-runbook.md`, `2026-07-08-production-deployment-plan.md`,
  `2026-07-12-welcome-flow-plan.md`) are dated records; the two
  orchestration docs get a status banner pointing here, the rest are left
  as written.

### Migration

One Alembic revision: create `sync_runs` and its indexes. No data
migration; no column changes to existing tables. Deploy order does not
matter: the api creates rows the worker will pick up whenever it comes up,
and the old worker ignores the table.

### Tests

- `tests/app/sync/test_sync_orchestration.py` is rewritten without the
  Temporal test server: router tests with a mocked session (enqueue conflict
  -> attaches; status mapping incl. `queued` -> `running`, `none`), pipeline
  tests with a fake `SyncSteps` and a fake run store (all steps in order,
  stops at first failure, non-retryable skips retries, retryable retries then
  fails, timeout wording and warning, resume skips completed steps, lost
  lease cancels the step, cancellation requeues, summaries), dispatch tests
  (order, conflict counted as skipped, failure isolated, cleanup failure
  isolated), and the step tests carried over (commit-and-wrap, non-retryable
  preconditions, `_user_facing_errors`).
- `tests/app/test_worker_schedule.py` becomes tests for the next-fire-time
  and catch-up decision.
- `tests/helpers.py` drops the `temporal` override.

The whole suite no longer needs a network fetch on first run.

### Verification

`uv run ruff check . && uv run ruff format --check . && uv run ty check &&
uv run pytest` in `backend/`; `npm run lint && npm run build` in `frontend/`;
`supabase start && docker compose up --build`, run a manual sync from the
welcome flow and watch the step playback, refresh mid-run to confirm
re-attach, and confirm the worker log shows the claim.
