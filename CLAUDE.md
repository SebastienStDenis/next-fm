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

- `config.py` - pydantic-settings `Settings` (reads `backend/.env`), cached via `get_settings()`. `DATABASE_URL` uses `postgresql+psycopg://` (psycopg 3, async).
- `db.py` - async engine + `async_sessionmaker`; `get_session` is the FastAPI dependency that yields an `AsyncSession`.
- `models.py` - SQLAlchemy 2.0 ORM models (`DeclarativeBase`, typed `Mapped`/`mapped_column`). Alembic autogenerate diffs against `Base.metadata`.
- `schemas.py` - Pydantic v2 API schemas. ORM models and Pydantic schemas are deliberately separate (no SQLModel); response models use `ConfigDict(from_attributes=True)`.
- `main.py` - FastAPI app and endpoints; inject sessions with `SessionDep = Annotated[AsyncSession, Depends(get_session)]`.
- `seed.py` - idempotent seed script (`python -m app.seed`).

Everything is async end to end: endpoints, sessions, migrations (`migrations/env.py` uses the async engine and pulls the URL from `app.config`).

### Frontend (`frontend/src/app/`)

App Router with server components fetching the API directly (`process.env.API_URL`, defaulting to `http://localhost:8000`; Compose sets it to `http://api:8000`).

Important: `frontend/AGENTS.md` warns that this Next.js version has breaking changes relative to training data - read the relevant guide in `frontend/node_modules/next/dist/docs/` before writing Next.js code.

### Configuration

Compose reads an optional root `.env` (see `.env.example`); defaults cover everything. Secrets belong in `docker-compose.yml` as `${KEY:?set in .env}` (no default) so missing values fail at startup. Running the backend outside Docker uses `backend/.env` (copy from `backend/.env.example`).
