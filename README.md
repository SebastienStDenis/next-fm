# Next.fm

A website for live-music discovery that works through listening instead of listings. It connects to a user's music taste, finds artists they'd like who are playing in their city in the coming weeks or months, and delivers the result as a Spotify playlist rather than a list of shows - so they can actually *hear* who's coming to town and decide who's worth seeing. The playlist stays fresh as new shows get announced; when an artist hooks them, they go find the tickets.

## V1 connections

- **Last.fm** - the taste source. Users enter their username, and it provides their top artists plus similar-artist suggestions for discovery. Free, open API, no login or approval process.
- **Bandsintown** - the events source. The industry's broadest concert database (~2.3M events/year, aggregating Ticketmaster, AXS, Eventbrite, and artist-listed dates - it's what powers concert listings in Spotify and Apple Music). Used to check which of the user's matched artists have upcoming dates near them.
- **Spotify via a bot account** - the delivery mechanism. A dedicated account owned by Next.fm creates and maintains one playlist per user; the user just taps "Add to library." No Spotify sign-in required from the user, and because Next.fm owns the playlist, it can refresh it automatically as new shows are announced.

## Stack

Full-stack monorepo: FastAPI backend, Next.js frontend, Postgres database, Docker for local development.

### Backend (`backend/`)
- Python 3.14, dependencies and environments managed with [uv](https://docs.astral.sh/uv/)
- FastAPI with async endpoints
- SQLAlchemy 2.0 (async engine/sessions, typed `Mapped`/`mapped_column` models)
- psycopg 3 driver (`postgresql+psycopg://` URLs, `create_async_engine`/`AsyncSession`)
- Pydantic v2 for API schemas, pydantic-settings for configuration; ORM models and Pydantic schemas are kept separate (no SQLModel)
- Alembic migrations, initialized with the async template (`alembic init -t async migrations`)
- Lint/format: ruff. Type checking: ty. Tests: pytest

### Frontend (`frontend/`)
- Next.js (App Router, TypeScript, Tailwind CSS, ESLint)

### Database
- PostgreSQL 18 (Docker)

## Running locally

```sh
docker compose up --build
```

This starts:
- Postgres on `localhost:5432` (user/password `postgres`, database `app`)
- API on <http://localhost:8000> (applies migrations and seeds on startup, hot reload)
- Web on <http://localhost:3000> (hot reload)

Source directories are bind-mounted into the containers, so code edits hot-reload. Dependency and config-file changes (lockfiles, `pyproject.toml`, `next.config.ts`, ...) are baked into the images: rebuild with `docker compose up -d --build`.

Endpoints:
- `GET /health` - API + database health check
- `GET /users` - list users
- `GET /users/{id}` - fetch one user
- `GET /users/{id}/lastfm` - view the user's linked Last.fm account
- `PUT /users/{id}/lastfm` - link a Last.fm account (replaces any existing link)
- `POST /users/{id}/lastfm/refresh` - re-fetch the linked account's details from Last.fm
- <http://localhost:3000/users> - web page listing all users, with per-user profiles for linking Last.fm
- <http://localhost:8000/docs> - interactive API docs (Swagger UI)

### Configuration and secrets

All configuration lives in a single `.env` at the repo root (`cp .env.example .env`). Compose reads it to configure the containers, and the backend reads the same file when run outside Docker (real environment variables take precedence). Defaults cover everything except secrets, which are referenced in `docker-compose.yml` without a default (`${KEY:?set in .env}`) so missing values fail at startup. `LASTFM_API_KEY` needs a [Last.fm API account](https://www.last.fm/api/account/create); `BANDSINTOWN_API_KEY` is the app_id for the [Bandsintown API](https://artists.bandsintown.com/support/api-installation).

### Managing the stack

```sh
docker compose up -d            # start in the background
docker compose down             # stop everything (data persists)
docker compose down -v          # stop and wipe the database volume
docker compose logs -f api      # tail logs (api, web, or db)
docker compose up -d --build    # rebuild after dependency or config changes
docker compose up -d db         # start only Postgres (for running apps outside Docker)
docker compose exec db psql -U postgres app   # psql shell into the database
```

Host ports are configurable, so a second stack (e.g. from a git worktree) can run alongside the main one under its own project name:

```sh
DB_PORT=5433 API_PORT=8001 WEB_PORT=3001 docker compose -p my-branch up -d --build
docker compose -p my-branch down -v           # tear it down, including its database volume
```

### Running the backend outside Docker

```sh
cd backend
uv sync
uv run alembic upgrade head
uv run python -m app.seed
uv run uvicorn app.main:app --reload
```

Requires Postgres running (e.g. `docker compose up -d db`) and the root `.env` (see above).

### Backend checks

```sh
cd backend
uv run ruff check .             # lint (add --fix to auto-fix)
uv run ruff format .            # format
uv run ty check                 # type check
uv run pytest                   # tests
```

Tests are unit tests: the database dependency is stubbed out, so nothing needs to be running.

### Managing backend dependencies

```sh
cd backend
uv add <package>                # add a runtime dependency
uv add --dev <package>          # add a dev dependency
uv sync                         # sync the environment with the lockfile
uv lock --upgrade               # upgrade all dependencies within constraints
```

### Frontend

```sh
cd frontend
npm install                     # install dependencies
npm run dev                     # dev server on http://localhost:3000
npm run lint                    # eslint
npm run build                   # production build
npm start                       # serve the production build
```

## Migrations

Autogenerate-driven Alembic workflow. Review every generated migration before applying. Migrations are forward-only: fix mistakes with a new revision, do not rely on downgrades.

```sh
cd backend
uv run alembic revision --autogenerate -m "describe the change"
# review the file in migrations/versions/, then:
uv run alembic upgrade head
```

Other useful commands:

```sh
uv run alembic current          # show the revision the database is on
uv run alembic history          # list all revisions
uv run alembic upgrade +1       # apply one migration at a time
```
