# Sync orchestration design (Temporal)

*Written 2026-07-07 by Claude (Fable 5).*

How the four per-user sync steps - artist ingestion
(`docs/design/2026-07-05-artist-ingestion-plan.md`), suggestions
(`docs/design/2026-07-06-artist-suggestions-plan.md`), event ingestion
(`docs/design/2026-07-06-event-ingestion-plan.md`), and playlist generation
(`docs/design/2026-07-06-playlist-plan.md`) - become one durable pipeline behind a single
"Sync" button, with live per-step progress in the UI. Orchestration runs on Temporal,
and the design constraint throughout is dev/prod parity: the workflow, activities,
worker, and API code are identical in both environments; only connection env vars
change.

> **Status: implemented as designed.** Scheduled background re-sync and on-demand
> rate limiting remain out of scope; the last section sketches how this design
> accommodates them later. Scheduled re-sync is now designed in
> `docs/design/2026-07-09-background-sync-plan.md`.

## Why Temporal (and what the alternative was)

Today each sync step is a separate `POST` endpoint that runs inline in the HTTP
request (`main.py:389`, `:433`, `:451`, `:626`) behind its own button. That already
strains at playlist sync, whose button says "Syncing... (this can take a while)": a
cold run walks MusicBrainz at 1 req/s and can hold the request open for minutes. A
dropped connection, an api container restart, or a deploy mid-run loses the work
silently. Chaining all four steps into one request makes that several times worse.

What the one-button feature actually needs:

- **Durability**: a multi-minute pipeline that survives process restarts and resumes
  where it left off.
- **Retries with policy**: every step calls flaky third-party APIs; retry transient
  failures, fail fast on config errors.
- **Dedup**: clicking "Sync" twice must not run two pipelines for the same user.
- **Observable progress**: the UI needs "step 2 of 4, running" without us building a
  job-state table and keeping it honest.

Temporal provides all four natively: workflows are durable and resumable, activities
carry declarative retry policies, workflow IDs give per-user dedup for free, and
query handlers expose live progress. It also directly serves the two stated future
needs - rate limiting (worker- and task-queue-level throttles) and scheduled re-sync
(Temporal Schedules) - without new infrastructure.

The lighter alternative: a `sync_runs` table plus a background task runner (FastAPI
`BackgroundTasks`, or arq/Celery). That reimplements retries, dedup, crash recovery,
and progress bookkeeping by hand, poorly - a `BackgroundTasks` job dies with the
process, and a `sync_runs` row wedged at `running` after a crash needs janitor logic
Temporal simply doesn't require. It also fails the parity requirement: the dev
shortcut (in-process background tasks) is exactly what production can't use. The real
cost of Temporal is two extra dev containers, one new worker process, and the SDK's
determinism rules for workflow code. For a pipeline this shape, that trade is worth
it.

## The pipeline (grounding)

Four steps, in dependency order - each reads what the previous one wrote:

| # | Step | Entrypoint | External APIs | Cost profile |
|---|------|-----------|---------------|--------------|
| 1 | Artists | `artist_sync.sync_lastfm_artists` (`artist_sync.py:40`) | Last.fm | ~11 requests max (top artists + paginated loved tracks) |
| 2 | Suggestions | `suggestion_sync.sync_user_suggestions` (`suggestion_sync.py:86`) | Last.fm | One `getSimilar` per stale seed (30-day TTL, concurrency 4); hundreds cold, near-zero warm |
| 3 | Events | `event_sync.sync_user_events` (`event_sync.py:29`) | Bandsintown | One call per stale interest artist (24 h global TTL, concurrency 8) |
| 4 | Playlists | `playlist_sync.sync_user_playlists` (`playlist_sync.py:59`) | MusicBrainz, Spotify, Last.fm | Longest: MusicBrainz throttled to 1 req/s, Spotify searches, one 100-URI replace per playlist |

Properties the orchestration relies on, all true today:

- **Per-user scope, session-first signatures.** Every entrypoint takes an
  `AsyncSession` plus API clients and a user reference. Activities can call them
  unchanged.
- **Idempotent by construction.** All four are reconcile-style: upserts into global
  caches gated by TTLs, full-replace playlist writes, interest rows keyed by
  (user, artist, kind). Retrying a step after a partial failure converges to the
  same state. This is what makes Temporal's at-least-once activity execution safe
  without new code.
- **Transaction boundaries.** Steps 1-3 leave commits to the caller (today, the
  endpoint). `playlist_sync` additionally commits internally (`playlist_sync.py:98`,
  `:401`) to bank global cache work and avoid orphaning created Spotify playlists -
  which also means a retried playlist activity resumes with those caches warm.

## Architecture

Two new backend processes-worth of code, no changes to the sync modules themselves:

```
web ──► api (FastAPI) ──start/query──► temporal (server) ◄──poll──── worker
                                            │                          │
              db (Postgres) ◄───────────────┘ (temporal DBs)           │
                    ▲                                                  │
                    └───────────── sync modules + API clients ─────────┘
```

- The **api** container gains a Temporal client (created once in the FastAPI
  lifespan) and two endpoints: start a sync, read its progress. It never runs sync
  work itself anymore for the one-button flow.
- A new **worker** container (same image as the api, different command) polls a task
  queue and executes the workflow and activities. Activities call the existing sync
  entrypoints with sessions from `db.session_factory` and worker-owned API clients.
- The **temporal** server persists workflow state in the existing Postgres instance
  (its own databases), with the Temporal Web UI alongside for run inspection.

New backend modules, following the existing flat layout:

- `app/temporal.py` - settings-driven connection helper shared by api and worker:
  `connect_temporal(settings) -> temporalio.client.Client`. Plain connection when
  `TEMPORAL_API_KEY` is unset (local server), TLS + API key when set (Temporal
  Cloud). This one function is the entire dev/prod switch.
- `app/sync_workflow.py` - the workflow definition and the progress/step models.
  Deterministic code only; no IO, no ORM imports outside
  `workflow.unsafe.imports_passed_through()`.
- `app/sync_activities.py` - one activity per step, implemented as methods on a
  class holding the four long-lived API clients, so a single worker process shares
  one `MusicBrainzClient` (its 1 req/s throttle is per-instance,
  `musicbrainz.py:41`).
- `app/worker.py` - the worker entrypoint (`python -m app.worker`): connect, build
  clients, run `temporalio.worker.Worker` on the task queue with the workflow and
  activities registered.

Both api and worker use `temporalio.contrib.pydantic.pydantic_data_converter`, so
the existing Pydantic result models (`ArtistSyncResult`, `SuggestionSyncResult`,
`EventSyncResult`, `PlaylistSyncResult`) serialize across activity boundaries
without translation.

## Workflow design

One workflow, `SyncUserWorkflow`, input `user_id: str`, executing the four
activities strictly in order. Sketch:

```python
@workflow.defn
class SyncUserWorkflow:
    def __init__(self) -> None:
        self._steps = [StepProgress(key=k, status="pending") for k in STEP_KEYS]

    @workflow.run
    async def run(self, user_id: str) -> SyncRunResult:
        for step in self._steps:
            step.status = "running"
            try:
                summary = await workflow.execute_activity(
                    ACTIVITY_FOR_STEP[step.key], user_id,
                    schedule_to_close_timeout=TIMEOUT_FOR_STEP[step.key],
                    retry_policy=RETRY_POLICY,
                )
            except ActivityError:
                step.status = "failed"
                # remaining steps stay "pending"; rethrow to fail the run
                raise
            step.status = "completed"
            step.summary = summary
        return SyncRunResult(steps=self._steps)

    @workflow.query
    def progress(self) -> list[StepProgress]:
        return self._steps
```

- **Workflow ID**: `user-sync-{user_id}`. Started with conflict policy
  `USE_EXISTING`: clicking "Sync" while a run is in flight attaches to the running
  workflow instead of erroring or double-running. The default reuse policy allows a
  fresh run once the previous one closed. This is the entire dedup story - no locks,
  no DB flags.
- **Sequential, fail-stop.** Later steps consume earlier steps' writes, so a failed
  step (after retries) fails the run; downstream steps don't execute. The failed
  step is marked in the progress state the UI reads.
- **Retry policy** (per activity): initial interval 1 s, backoff 2.0, max interval
  30 s, max 3 attempts. Non-retryable failure types for the cases where retrying is
  pointless: missing API credentials, user not found, no linked Last.fm account
  (activities raise `ApplicationError(..., non_retryable=True)` for these, mirroring
  the 404/503 paths the individual endpoints have today, `main.py:75-139`, `:306`).
- **Timeouts** (`schedule_to_close`, generous because cold runs are real): artists
  2 min, suggestions 15 min, events 15 min, playlists 30 min. Schedule-to-close
  covers queue wait plus every retry, so a run fails within its step budget
  instead of sitting RUNNING forever when no worker is polling the queue.
  No heartbeating in v1;
  it requires threading a callback into the sync modules and buys intra-step
  progress plus faster stuck-worker detection - noted as a follow-up, not needed for
  a 4-step checklist UI.
- **Progress** is workflow-local state exposed through a `@workflow.query` handler.
  No progress table, no pub/sub; the workflow's own state is the source of truth,
  and queries work for as long as the run is retained (see retention below).

### Activities

Each activity is a thin wrapper with identical shape - fetch prerequisites, call the
existing entrypoint, commit, return the existing result model:

```python
@activity.defn
async def sync_events(self, user_id: str) -> EventSyncResult:
    async with session_factory() as session:
        result = await sync_user_events(session, self.bandsintown, uuid.UUID(user_id))
        await session.commit()
        return result
```

Each attempt opens a fresh session and re-fetches the `User` / linked account where
the entrypoint needs them, so retries never reuse stale ORM state. Each activity is
its own transaction boundary, exactly matching what the four endpoints do today.

The activity class owns the four API clients for the life of the worker process.
That preserves the MusicBrainz 1 req/s guarantee per process. Running **multiple
worker replicas** would break that guarantee (each replica throttles independently);
the fix, when scale demands it, is a dedicated task queue for the playlist activity
with a worker-side `max_task_queue_activities_per_second` cap. Until then: one
worker replica, documented as a constraint.

## API surface

Two new endpoints in `main.py`; the four per-step sync endpoints stay (they're
useful for development and debugging) but the UI stops using them.

**`POST /users/{user_id}/sync`** - start (or attach to) a sync. Validates the user
exists and has a linked Last.fm account (mirroring `_linked_lastfm_account`,
`main.py:306`) so obviously-doomed workflows are never started, then:

```python
handle = await temporal.start_workflow(
    SyncUserWorkflow.run, str(user_id),
    id=f"user-sync-{user_id}",
    task_queue=settings.temporal_task_queue,
    id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
)
```

Returns `202` with `{"workflow_id": ..., "run_id": ..., "status": "running"}`.
Starting while a run is active returns the existing run's identifiers - the endpoint
is idempotent from the UI's perspective.

**`GET /users/{user_id}/sync`** - current progress / last outcome. Looks up the
handle by workflow ID, combines `describe()` (overall status, start/close times)
with the `progress` query (per-step state):

```json
{
  "status": "running",
  "started_at": "2026-07-07T18:02:11Z",
  "steps": [
    {"key": "artists",     "status": "completed", "summary": "212 artists, 2 kinds"},
    {"key": "suggestions", "status": "running",   "summary": null},
    {"key": "events",      "status": "pending",   "summary": null},
    {"key": "playlists",   "status": "pending",   "summary": null}
  ]
}
```

`status` is one of `running | completed | failed | none` (`none` when no workflow
with that ID exists or its history has aged out of retention). The endpoint is
read-only and cheap; the frontend polls it.

The Temporal client is connected once in the FastAPI lifespan and injected as a
dependency (`TemporalDep`), following the pattern of the existing client
dependencies. If Temporal is unreachable or unconfigured, the two endpoints return
503 - same convention as the missing-API-key paths (`main.py:75-139`).

## Frontend

Replace the four per-tab sync buttons (`artists-panel.tsx:119`,
`suggested-artists-panel.tsx:52`, `events-panel.tsx:113`, `playlists-panel.tsx:100`)
and their server actions with one sync card on the user detail page
(`users/[id]/page.tsx`), rendered above the tabs:

- One **"Sync" button** posting to `POST /users/{id}/sync` via a server action.
- A **four-step checklist** showing each step's label, status (pending / running /
  completed / failed) and the summary line once available - the same one-line count
  summaries the per-tab actions build today (`actions.ts:130`, `:163`, `:212`,
  `:253`) move into this card.
- A client component **polls `GET /users/{id}/sync` every ~1.5 s** while status is
  `running` (plain `fetch` + `setInterval`; no library needed). The server component
  fetches the same endpoint at render time for the initial state, so a page load
  mid-sync shows live progress immediately.
- On reaching a terminal state, stop polling and call `router.refresh()` so the
  panels re-render with the new data - the equivalent of today's per-action
  `revalidatePath`.

Per `frontend/AGENTS.md`, check the vendored Next.js docs in
`frontend/node_modules/next/dist/docs/` before writing the polling and server-action
code.

## Configuration

New `Settings` fields (`config.py`), with `.env.example` entries. Defaults cover
local development entirely; none are secrets except the Cloud API key:

| Setting | Default | Compose override | Production |
|---------|---------|------------------|------------|
| `TEMPORAL_ADDRESS` | `localhost:7233` | `temporal:7233` | `<ns>.<acct>.tmprl.cloud:7233` |
| `TEMPORAL_NAMESPACE` | `default` | - | `<ns>.<acct>` |
| `TEMPORAL_TASK_QUEUE` | `user-sync` | - | same |
| `TEMPORAL_API_KEY` | empty | - | Cloud API key (secret) |

`connect_temporal` reads these and nothing else. Setting the three
address/namespace/key values is the complete migration from the local server to
Temporal Cloud; no code changes, no image changes. A self-hosted production Temporal
works the same way minus the API key.

## Development infrastructure (compose)

Three additions to `docker-compose.yml`:

```yaml
temporal:
  image: temporalio/auto-setup:<pinned>
  environment:
    DB: postgres12            # driver name; supports PG 12+
    POSTGRES_SEEDS: db
    DB_PORT: 5432
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PWD: ${POSTGRES_PASSWORD}
  ports: ["7233:7233"]
  depends_on:
    db: { condition: service_healthy }

temporal-ui:
  image: temporalio/ui:<pinned>
  environment:
    TEMPORAL_ADDRESS: temporal:7233
  ports: ["8080:8080"]

worker:
  build: ./backend
  command: sh -c "uv run python -m app.worker"
  environment: # same DATABASE_URL + API secrets as api, plus TEMPORAL_ADDRESS
  volumes:     # same app/ bind mount as api
  depends_on:
    db: { condition: service_healthy }
    temporal: { condition: service_started }
```

- **Persistence in the existing Postgres.** `auto-setup` creates and migrates its
  own `temporal` and `temporal_visibility` databases inside the `db` container - no
  second database server. Workflow state survives `docker compose down` (volumes
  kept), which matters: an in-memory dev server would forget in-flight runs and
  contradict the durability story we're building on. (The one-container
  `temporal server start-dev` CLI image is the lighter alternative, but its
  ephemerality makes it strictly worse here for two containers' savings.)
- **Ports**: 7233 (gRPC) and 8080 (Temporal UI) are free today (3000 web, 8000 api,
  5432 db).
- **Namespace retention** controls how long closed runs answer `describe`/queries -
  i.e. how long "last sync outcome" survives in the UI. Set it to 7 days at setup
  (auto-setup supports a default-namespace retention env var; verify the exact name
  against the pinned image). If we later want durable sync history beyond retention,
  that's a small `sync_runs` log table written by the workflow's final activity -
  deliberately not in v1, to keep Temporal the single source of truth for run state.
- **Worker hot reload**: uvicorn's `--reload` doesn't apply. Either restart the
  worker container after backend edits or wrap the command with `watchfiles` as a
  dev nicety; decide during implementation.
- The api container's startup (migrations + seed) is unchanged; the worker doesn't
  run migrations, it only depends on them having run (worker retries its Temporal/DB
  connections on startup rather than racing the api container).

## Production parity checklist

What this design keeps identical between dev and prod, and the few things that
legitimately differ:

**Identical**: workflow, activities, worker entrypoint, API endpoints, progress
contract, task queue name, data converter, retry/timeout policies, the backend
image (worker and api build from the same Dockerfile).

**Differs by env var only**: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`,
`TEMPORAL_API_KEY` (Temporal Cloud or self-hosted vs local `auto-setup`).

**Differs by infrastructure, not code**: `auto-setup` is explicitly not a
production-grade deployment (single container, no HA); production uses Temporal
Cloud or a properly deployed self-hosted cluster. Secrets move from `.env` to the
production secret store, following the same `${KEY:?set in .env}` fail-fast
convention compose uses today.

**Known scale constraint**: one worker replica until the MusicBrainz throttle moves
to a rate-limited dedicated task queue (see Activities above).

## Future work (out of scope, but designed for)

- **On-demand rate limiting.** Two cheap layers when needed: the `POST` endpoint
  checks the last run's close time via `describe()` and returns 429 within a
  cooldown window; and/or the workflow itself refuses to re-run within N minutes.
  No schema needed.
- **Scheduled background re-sync.** A Temporal Schedule triggers a small dispatcher
  workflow on a cadence; it picks the stalest ACTIVE users and starts
  `SyncUserWorkflow` for each with `USE_EXISTING` (so on-demand and scheduled runs
  can never collide - same workflow ID). This needs two things the schema lacks
  today: a user activity flag and a per-user `last_synced_at` (the natural place to
  write it is a final workflow step; `Playlist.last_synced_at`, `models.py:328`, is
  the closest existing proxy). Both arrive with that feature, not now.
- **Throughput knobs.** Worker `max_concurrent_activities` and per-task-queue rate
  limits bound our aggregate pressure on Last.fm/Bandsintown/Spotify once multiple
  users sync concurrently.
- **Intra-step progress** via activity heartbeats carrying "resolved 34/120
  artists" payloads, surfaced through the same query/polling channel.

## Implementation phases

Each phase lands as its own PR and leaves the app fully working.

1. **Infrastructure**: add `temporalio` to `backend/pyproject.toml`; new settings +
   `.env.example` entries; `app/temporal.py` connection helper; `temporal`,
   `temporal-ui`, and (empty-for-now) `worker` compose services. Verify: Temporal UI
   reachable at :8080, `temporal` CLI can hit :7233.
2. **Pipeline**: `app/sync_workflow.py`, `app/sync_activities.py`, `app/worker.py`.
   Verify end to end by starting `user-sync-<seed-user-id>` from the Temporal UI/CLI
   and watching the four steps run.
3. **API**: lifespan-managed Temporal client, `POST`/`GET /users/{id}/sync`,
   schemas for the progress payload. Unit tests mock the Temporal client;
   workflow-level tests use `temporalio.testing.WorkflowEnvironment` with
   time-skipping and mocked activities (note: it downloads a test-server binary on
   first run).
4. **Frontend**: sync card with button + checklist + polling; delete the four
   per-tab buttons and their actions; move the summary-string formatting into the
   card.
5. **Docs/cleanup**: root `CLAUDE.md` module list (new modules, worker command),
   README if it mentions per-step syncing.

## Open questions

- **Pin versions at implementation time**: `temporalio` SDK, `temporalio/auto-setup`
  and `temporalio/ui` images, and the exact auto-setup retention env var name.
- **Individual sync endpoints**: kept for debugging in this plan; revisit removing
  them once the orchestrated path has been the only UI path for a while.
- **Seed-user ergonomics**: the seeded "Ada Lovelace" user has no linked Last.fm
  account, so `POST /sync` 404s until one is linked - fine, but worth a friendly
  UI state ("link a Last.fm account to sync").
