# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project

Live-music discovery delivered as Spotify playlists: match a user's taste (Last.fm) against upcoming concerts near them (Ticketmaster and Resident Advisor), and maintain one playlist per user via an app-owned Spotify bot account. See README.md for the full product description.

Monorepo: `backend/` (FastAPI, Python 3.14, managed with uv), `frontend/` (Next.js App Router, TypeScript, Tailwind v4). App data and auth run on the Supabase CLI stack (`supabase start`); Docker Compose runs the app services (api, web, sync worker).

When working on user-facing copy, consult `docs/wording.md`; when working on styling or visual design, consult `docs/theme.md`; when working on alerting, logging, or anything about running this in production, consult `docs/operations.md`. All three are living reference docs - follow them and update them in the same change when the product, theme, or alerting evolves.

Nested `AGENTS.md` files add rules for their subtree: `frontend/AGENTS.md`, `docs/AGENTS.md`. Read the one covering the files you touch. The `CLAUDE.md` files alongside them only re-export these; keep the content here.

## Commands

### Full stack

```sh
supabase start                  # app Postgres :54322, Auth/API :54321, Studio :54323
docker compose up --build       # API :8000, web :3000, sync worker
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`supabase start` must be running before `docker compose up` (the app data and
auth engine live in it). Tear down with `docker compose down` and, when done,
`supabase stop`. Running the apps outside Docker needs only `supabase start`
(`uv run python -m app.worker` from `backend/` runs the sync worker).

Source directories are bind-mounted, so code edits hot-reload. Dependency and config-file changes (lockfiles, `pyproject.toml`, `next.config.ts`, ...) are baked into the images: rebuild with `docker compose up -d --build`. The api container applies migrations on startup; cities seeding is a one-time manual step per environment (`docker compose run --rm api uv run python -m cli.seed`, or `uv run python -m cli.seed` from `backend/`).

### Backend (run from `backend/`)

```sh
uv sync                         # install/sync environment
uv run ruff check .             # lint (--fix to auto-fix)
uv run ruff format .            # format
uv run ty check                 # type check
uv run pytest                   # all tests
uv run pytest tests/app/test_health.py::test_health   # single test
uv run uvicorn app.main:app --reload              # dev server (needs Postgres + backend/.env)
```

Tests are unit tests: the database dependency is overridden (`app.dependency_overrides[get_session]`), so nothing needs to be running. pytest-asyncio is in auto mode - async test functions need no decorator.

### Migrations (run from `backend/`)

Autogenerate-driven Alembic, async template. Forward-only: fix mistakes with a new revision, never rely on downgrades.

```sh
uv run alembic revision --autogenerate -m "describe the change"
# review the generated file in migrations/versions/, then:
uv run alembic upgrade head
```

### Frontend (run from `frontend/`)

```sh
npm run dev                     # dev server on :3000
npm run lint                    # eslint
npm run build                   # production build
```

## Architecture

### Backend (`backend/app/`)

Small layered FastAPI app grouped into scoped packages; keep the separation when adding features:

Entrypoints (top of `app/`):

- `main.py` - FastAPI app assembly: CORS, the per-upstream exception handlers, `/health`, and the `include_router` calls; endpoints live in `routers/`.
- `worker.py` - sync worker entrypoint (`python -m app.worker`), run by the `worker` compose service: a couple of lanes poll the `sync_runs` queue and execute runs, and, when `NIGHTLY_SYNC_ENABLED` is true, a scheduler runs the nightly dispatch at 06:00 UTC.

`routers/` - the API endpoints, one `APIRouter` per domain: `account.py` (user profile/deletion, city search and home city), `lastfm.py` (account link/refresh/unlink), `artists.py` (interests, exclusions), `events.py`, `playlists.py`, `sync.py` (full-sync start/status on the `sync_runs` queue; syncing happens only in the worker, never inline in a request). Inject sessions with `SessionDep` and external clients with the `*ClientDep` aliases, all from `core/deps.py`.

`core/` - foundation shared by everything:

- `config.py` - pydantic-settings `Settings` (reads the root `.env`; real env vars win), cached via `get_settings()`. `DATABASE_URL` uses `postgresql+psycopg://` (psycopg 3, async).
- `db.py` - async engine + `async_sessionmaker`; `get_session` is the FastAPI dependency that yields an `AsyncSession`.
- `models.py` - SQLAlchemy 2.0 ORM models (`DeclarativeBase`, typed `Mapped`/`mapped_column`). Alembic autogenerate diffs against `Base.metadata`.
- `schemas.py` - Pydantic v2 API schemas. ORM models and Pydantic schemas are deliberately separate (no SQLModel); response models use `ConfigDict(from_attributes=True)`.
- `auth.py` - Supabase JWT verification and the `get_current_user` dependency: resolves tokens to `User` rows (JIT provisioning) and stamps `users.last_seen_at`, the activity signal for the nightly sync.
- `deps.py` - the FastAPI dependency providers: `SessionDep` plus the external-client deps (`LastfmClientDep`, `SpotifyClientDep`, ...), each yielding a client per request and 503ing when its settings are missing.
- `accounts.py` - shared linked-Last.fm-account lookup used by both the API and the sync steps.
- `observability.py` - `configure_observability()`, called once by both the API and the worker: installs the root log handler (uvicorn configures only its own loggers) and starts Sentry when `SENTRY_DSN` is set. Reporting is wired at WARNING, not Sentry's ERROR default, because that is the level this codebase logs real failures at; log records also forward to Sentry Logs alongside Render's own capture. Where each failure surfaces, and what to do about it, is `docs/operations.md`.

`clients/` - external API clients:

- `lastfm.py` - async Last.fm API client (`LastfmClient.get_user_info`, `get_top_artists`, `get_loved_tracks`, `get_artist_top_tracks`), injected via the `get_lastfm_client` dependency in `core/deps.py`.
- `ticketmaster.py` - async Ticketmaster Discovery API client (attraction resolution, per-attraction upcoming events), rate-limited to 5 req/s.
- `ra.py` - async Resident Advisor client speaking the unofficial GraphQL endpoint behind ra.co (artist search, per-artist upcoming events), politely throttled to 1 req/s; expect breakage (see `docs/design/2026-08-09-multi-source-event-ingestion.md`).
- `source_events.py` - the source-neutral event payload (`SourceEventData`) both concert clients emit, plus the shared name-matching key.
- `spotify.py` - async Spotify Web API client acting as the app's bot account (token refresh, search, playlist writes); see `docs/design/2026-07-06-playlist-plan.md`.
- `musicbrainz.py` - async MusicBrainz client (MBID -> Spotify artist link), throttled to 1 req/s.
- `supabase_admin.py` - minimal async GoTrue admin client (auth-user deletion), authorized by the Supabase secret key.

`sync/` - the sync domain:

- `artist_sync.py` - ingests Last.fm taste signals into the canonical artist registry and per-user interests (see `docs/design/2026-07-05-artist-ingestion-plan.md`).
- `suggestion_sync.py` - recomputes each user's suggested artists from Last.fm similar-artist edges: seed affinity, scoring, selection with hysteresis, known-artist floors, show-tied grace (see `docs/design/2026-07-06-artist-suggestions-plan.md`).
- `event_sync.py` - refreshes upcoming events per interest artist from Ticketmaster and RA, merging cross-source duplicates onto one canonical event (see `docs/design/2026-08-09-multi-source-event-ingestion.md`, which supersedes the Bandsintown-era `docs/design/2026-07-06-event-ingestion-plan.md`).
- `playlist_sync.py` - reconciles per-user Spotify playlists against matched shows: artist resolution, top-track cache, desired-state computation, one full-replace write per playlist whose tracklist changed (see `docs/design/2026-07-06-playlist-plan.md`); also the deletion side - unfollow tombstones, their drainer, and the bot-account orphan audit (see `docs/design/2026-07-10-playlist-deletion-plan.md`).
- `matching.py` - the shared artist/event match pieces: known/suggested kind sets, the servable-artist filter (setting + exclusions), the match join, haversine distance.
- `sync_runs.py` - the `sync_runs` queue: enqueue (at most one active run per user, enforced by a partial unique index), claim with `FOR UPDATE SKIP LOCKED`, the claim-fenced progress/heartbeat/finish writes, and the latest-run lookup the status endpoint serves (see `docs/design/2026-08-16-postgres-sync-queue-plan.md`).
- `sync_pipeline.py` - the step specs and summaries, `run_sync` (executes one claimed run: the four steps in order with retries, timeouts, and live per-step progress written to the run row), and `dispatch_nightly_syncs` (the nightly re-sync: each due user one at a time, then the playlist cleanup and run pruning).
- `sync_steps.py` - `SyncSteps`, the units of work the worker executes: the four sync entrypoints plus the playlist cleanup (orphan audit, tombstone drain) and the nightly eligibility query; each step opens its own session and commits, and fails with a `SyncStepError` carrying the only message the user sees.

Everything is async end to end: endpoints, sessions, migrations (`migrations/env.py` uses the async engine and pulls the URL from `app.core.config`).

### Operator CLI (`backend/cli/`)

Operator tooling, run manually from `backend/`; never imported by the service, and deliberately outside the `app` package:

- `seed.py` - idempotent cities seed (`python -m cli.seed`), run once per new environment and re-run to refresh; `docs/operations.md` has the runbook.
- `geonames.py` - downloads and parses the GeoNames dumps (cities with population >= 15k, admin1 region names) for the city seed.
- `spotify_auth.py` - CLI for the bot-account authorization (`python -m cli.spotify_auth`); prints the `SPOTIFY_REFRESH_TOKEN` for `.env`. Spotify expires refresh tokens after 6 months, so this recurs; `docs/operations.md` has the runbook, including the production side the script itself doesn't mention.

### Frontend (`frontend/src/app/`)

App Router with server components fetching the API directly (`process.env.API_URL`, defaulting to `http://localhost:8000`; Compose sets it to `http://api:8000`).

Important: `frontend/AGENTS.md` warns that this Next.js version has breaking changes relative to training data - read the relevant guide in `frontend/node_modules/next/dist/docs/` before writing Next.js code.

### Configuration

All configuration lives in a single root `.env` (see `.env.example`): Compose reads it to configure the containers, and the backend reads the same file when run outside Docker (real env vars take precedence, so compose-injected values win inside containers). Defaults cover everything except secrets (`LASTFM_API_KEY`, `TICKETMASTER_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`). Secrets belong in `docker-compose.yml` as `${KEY:?set in .env}` (no default) so missing values fail at startup.
