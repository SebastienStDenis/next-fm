# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Live-music discovery delivered as Spotify playlists: match a user's taste (Last.fm) against upcoming concerts near them (Bandsintown), and maintain one playlist per user via an app-owned Spotify bot account. See README.md for the full product description.

Monorepo: `backend/` (FastAPI, Python 3.14, managed with uv), `frontend/` (Next.js App Router, TypeScript, Tailwind v4), PostgreSQL 18 via Docker Compose.

## Commands

### Full stack

```sh
docker compose up --build       # Postgres :5432, API :8000, web :3000
docker compose up -d db         # only Postgres (for running apps outside Docker)
docker compose exec db psql -U postgres app
```

Source directories are bind-mounted, so code edits hot-reload. Dependency and config-file changes (lockfiles, `pyproject.toml`, `next.config.ts`, ...) are baked into the images: rebuild with `docker compose up -d --build`. The api container applies migrations and seeds on startup.

### Backend (run from `backend/`)

```sh
uv sync                         # install/sync environment
uv run ruff check .             # lint (--fix to auto-fix)
uv run ruff format .            # format
uv run ty check                 # type check
uv run pytest                   # all tests
uv run pytest tests/test_health.py::test_health   # single test
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

Small layered FastAPI app; keep the separation when adding features:

- `config.py` - pydantic-settings `Settings` (reads the root `.env`; real env vars win), cached via `get_settings()`. `DATABASE_URL` uses `postgresql+psycopg://` (psycopg 3, async).
- `db.py` - async engine + `async_sessionmaker`; `get_session` is the FastAPI dependency that yields an `AsyncSession`.
- `models.py` - SQLAlchemy 2.0 ORM models (`DeclarativeBase`, typed `Mapped`/`mapped_column`). Alembic autogenerate diffs against `Base.metadata`.
- `schemas.py` - Pydantic v2 API schemas. ORM models and Pydantic schemas are deliberately separate (no SQLModel); response models use `ConfigDict(from_attributes=True)`.
- `lastfm.py` - async Last.fm API client (`LastfmClient.get_user_info`, `get_top_artists`, `get_loved_tracks`, `get_artist_top_tracks`), injected via the `get_lastfm_client` dependency in `main.py`.
- `bandsintown.py` - async Bandsintown API client for artists' upcoming events.
- `spotify.py` - async Spotify Web API client acting as the app's bot account (token refresh, search, playlist writes); see `docs/2026-07-06-playlist-plan.md`.
- `musicbrainz.py` - async MusicBrainz client (MBID -> Spotify artist link), throttled to 1 req/s.
- `artist_sync.py` - ingests Last.fm taste signals into the canonical artist registry and per-user interests (see `docs/2026-07-05-artist-ingestion-plan.md`).
- `event_sync.py` - refreshes upcoming events per interest artist from Bandsintown (see `docs/2026-07-06-event-ingestion-plan.md`).
- `playlist_sync.py` - reconciles per-user Spotify playlists against matched shows: artist resolution, top-track cache, desired-state computation, one full-replace write per playlist (see `docs/2026-07-06-playlist-plan.md`).
- `matching.py` - the artist/event match join pieces shared by events and playlists (haversine distance, radius).
- `geonames.py` - parses the vendored GeoNames dumps in `backend/data/` (cities with population >= 15k, admin1 region names) for the city seed.
- `main.py` - FastAPI app and endpoints; inject sessions with `SessionDep = Annotated[AsyncSession, Depends(get_session)]`.
- `seed.py` - idempotent seed script (`python -m app.seed`).
- `spotify_auth.py` - CLI for the one-time bot-account authorization (`python -m app.spotify_auth`); prints the `SPOTIFY_REFRESH_TOKEN` for `.env`.
- `spotify_verify.py` - throwaway Phase 0 script verifying development-mode Spotify API behavior (`python -m app.spotify_verify`).

Everything is async end to end: endpoints, sessions, migrations (`migrations/env.py` uses the async engine and pulls the URL from `app.config`).

### Frontend (`frontend/src/app/`)

App Router with server components fetching the API directly (`process.env.API_URL`, defaulting to `http://localhost:8000`; Compose sets it to `http://api:8000`).

Important: `frontend/AGENTS.md` warns that this Next.js version has breaking changes relative to training data - read the relevant guide in `frontend/node_modules/next/dist/docs/` before writing Next.js code.

### Configuration

All configuration lives in a single root `.env` (see `.env.example`): Compose reads it to configure the containers, and the backend reads the same file when run outside Docker (real env vars take precedence, so compose-injected values win inside containers). Defaults cover everything except secrets (`LASTFM_API_KEY`, `BANDSINTOWN_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`). Secrets belong in `docker-compose.yml` as `${KEY:?set in .env}` (no default) so missing values fail at startup.
