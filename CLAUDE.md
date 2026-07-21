# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Live-music discovery delivered as Spotify playlists: match a user's taste (Last.fm) against upcoming concerts near them (Bandsintown), and maintain one playlist per user via an app-owned Spotify bot account. See README.md for the full product description.

Monorepo: `backend/` (FastAPI, Python 3.14, managed with uv), `frontend/` (Next.js App Router, TypeScript, Tailwind v4). App data and auth run on the Supabase CLI stack (`supabase start`); Docker Compose runs the app services and Temporal.

When working on user-facing copy, consult `docs/wording.md`; when working on styling or visual design, consult `docs/theme.md`; when working on alerting, logging, or anything about running this in production, consult `docs/operations.md`. All three are living reference docs - follow them and update them in the same change when the product, theme, or alerting evolves.

## Commands

### Full stack

```sh
supabase start                  # app Postgres :54322, Auth/API :54321, Studio :54323
docker compose up --build       # API :8000, web :3000, Temporal :7233 (UI :8080), worker
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`supabase start` must be running before `docker compose up` (the app data and
auth engine live in it). Tear down with `docker compose down` and, when done,
`supabase stop`. Running the apps outside Docker needs `supabase start` plus the
`temporal` compose service.

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

Tests are unit tests: the database dependency is overridden (`app.dependency_overrides[get_session]`), so nothing needs to be running. pytest-asyncio is in auto mode - async test functions need no decorator. Exception: the workflow tests in `tests/app/sync/test_sync_orchestration.py` run against Temporal's time-skipping test server, which the SDK downloads on first use (a one-time network fetch).

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

- `main.py` - FastAPI app and endpoints; inject sessions with `SessionDep = Annotated[AsyncSession, Depends(get_session)]`.
- `worker.py` - Temporal worker entrypoint (`python -m app.worker`), run by the `worker` compose service; reconciles the `nightly-sync` schedule at startup (created when `NIGHTLY_SYNC_ENABLED` is true, deleted otherwise).

`core/` - foundation shared by everything:

- `config.py` - pydantic-settings `Settings` (reads the root `.env`; real env vars win), cached via `get_settings()`. `DATABASE_URL` uses `postgresql+psycopg://` (psycopg 3, async).
- `db.py` - async engine + `async_sessionmaker`; `get_session` is the FastAPI dependency that yields an `AsyncSession`.
- `models.py` - SQLAlchemy 2.0 ORM models (`DeclarativeBase`, typed `Mapped`/`mapped_column`). Alembic autogenerate diffs against `Base.metadata`.
- `schemas.py` - Pydantic v2 API schemas. ORM models and Pydantic schemas are deliberately separate (no SQLModel); response models use `ConfigDict(from_attributes=True)`.
- `auth.py` - Supabase JWT verification and the `get_current_user` dependency: resolves tokens to `User` rows (JIT provisioning) and stamps `users.last_seen_at`, the activity signal for the nightly sync.
- `accounts.py` - shared linked-Last.fm-account lookup used by both the API and the sync activities.
- `temporal.py` - Temporal client connection helper shared by API and worker; local server by default, Temporal Cloud when `TEMPORAL_API_KEY` is set.
- `observability.py` - `configure_observability()`, called once by both the API and the worker: installs the root log handler (uvicorn configures only its own loggers) and starts Sentry when `SENTRY_DSN` is set. Reporting is wired at WARNING, not Sentry's ERROR default, because that is the level this codebase logs real failures at; log records also forward to Sentry Logs alongside Render's own capture. Where each failure surfaces, and what to do about it, is `docs/operations.md`.

`clients/` - external API clients:

- `lastfm.py` - async Last.fm API client (`LastfmClient.get_user_info`, `get_top_artists`, `get_loved_tracks`, `get_artist_top_tracks`), injected via the `get_lastfm_client` dependency in `main.py`.
- `bandsintown.py` - async Bandsintown API client for artists' upcoming events; calls the undocumented `V3.1/` path, the one variant that returns real venue names on event-page listings (see `docs/design/2026-07-18-concert-venues.md`).
- `spotify.py` - async Spotify Web API client acting as the app's bot account (token refresh, search, playlist writes); see `docs/design/2026-07-06-playlist-plan.md`.
- `musicbrainz.py` - async MusicBrainz client (MBID -> Spotify artist link), throttled to 1 req/s.
- `supabase_admin.py` - minimal async GoTrue admin client (auth-user deletion), authorized by the Supabase secret key.

`sync/` - the sync domain:

- `artist_sync.py` - ingests Last.fm taste signals into the canonical artist registry and per-user interests (see `docs/design/2026-07-05-artist-ingestion-plan.md`).
- `suggestion_sync.py` - recomputes each user's suggested artists from Last.fm similar-artist edges: seed affinity, scoring, selection with hysteresis, known-artist floors, show-tied grace (see `docs/design/2026-07-06-artist-suggestions-plan.md`).
- `event_sync.py` - refreshes upcoming events per interest artist from Bandsintown (see `docs/design/2026-07-06-event-ingestion-plan.md`).
- `playlist_sync.py` - reconciles per-user Spotify playlists against matched shows: artist resolution, top-track cache, desired-state computation, one full-replace write per playlist whose tracklist changed (see `docs/design/2026-07-06-playlist-plan.md`); also the deletion side - unfollow tombstones, their drainer, and the bot-account orphan audit (see `docs/design/2026-07-10-playlist-deletion-plan.md`).
- `matching.py` - the shared artist/event match pieces: known/suggested kind sets, the servable-artist filter (setting + exclusions), the match join, haversine distance.
- `sync_workflow.py` - `SyncUserWorkflow`, the durable Temporal workflow chaining the four sync steps per user with queryable per-step progress (see `docs/design/2026-07-07-sync-orchestration-plan.md`), and `DispatchSyncsWorkflow`, the nightly re-sync running each due user as a sequential child sync (see `docs/design/2026-07-09-background-sync-plan.md`).
- `sync_activities.py` - Temporal activities wrapping the four sync entrypoints plus the nightly dispatch bookkeeping (eligibility listing, last-synced stamp) and playlist cleanup (orphan audit, tombstone drain); each attempt opens its own session and commits.

Everything is async end to end: endpoints, sessions, migrations (`migrations/env.py` uses the async engine and pulls the URL from `app.core.config`).

### Operator CLI (`backend/cli/`)

Operator tooling, run manually from `backend/`; never imported by the service, and deliberately outside the `app` package:

- `seed.py` - idempotent cities seed (`python -m cli.seed`), run once per new environment and re-run to refresh; `docs/operations.md` has the runbook.
- `geonames.py` - downloads and parses the GeoNames dumps (cities with population >= 15k, admin1 region names) for the city seed.
- `spotify_auth.py` - CLI for the bot-account authorization (`python -m cli.spotify_auth`); prints the `SPOTIFY_REFRESH_TOKEN` for `.env`. Spotify expires refresh tokens after 6 months, so this recurs; `docs/operations.md` has the runbook, including the production side the script itself doesn't mention.
- `spotify_verify.py` - throwaway Phase 0 script verifying development-mode Spotify API behavior (`python -m cli.spotify_verify`).

### Frontend (`frontend/src/app/`)

App Router with server components fetching the API directly (`process.env.API_URL`, defaulting to `http://localhost:8000`; Compose sets it to `http://api:8000`).

Important: `frontend/AGENTS.md` warns that this Next.js version has breaking changes relative to training data - read the relevant guide in `frontend/node_modules/next/dist/docs/` before writing Next.js code.

### Configuration

All configuration lives in a single root `.env` (see `.env.example`): Compose reads it to configure the containers, and the backend reads the same file when run outside Docker (real env vars take precedence, so compose-injected values win inside containers). Defaults cover everything except secrets (`LASTFM_API_KEY`, `BANDSINTOWN_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`). Secrets belong in `docker-compose.yml` as `${KEY:?set in .env}` (no default) so missing values fail at startup. The `TEMPORAL_*` settings default to the compose-provided Temporal server; pointing them at a Temporal Cloud namespace is the entire production switch.
