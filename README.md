# NextFM

A website for live-music discovery that works through listening instead of listings. It connects to a user's listening history, finds artists they'd like with upcoming concerts in their city, and generates a playlist with a few top songs for each one. Users can hear who's coming to town and decide if they want to see the. The playlist stays fresh as new concerts get announced.

## V1 connections

- **Last.fm** for listening history and suggestions. Users enter their username, and it provides their top artists plus similar-artist suggestions for discovery.
- **Ticketmaster and Resident Advisor** for concerts. Used to check which of the user's matched artists have upcoming concerts near them: Ticketmaster covers the mainstream circuit, RA the club and electronic scene.
- **Spotify** to generate playlists. A dedicated account owned by NextFM creates and maintains one playlist per user in each city they follow; the user just taps "Add to library" in Spotify. No Spotify sign-in required from the user, and because NextFM owns the playlist, it can refresh it automatically every day as the user's listening history changes and new concerts are announced.

## Stack

Full-stack monorepo: FastAPI backend, Next.js frontend, Supabase for Postgres and auth, Docker Compose for the app services and Temporal.

### Backend (`backend/`)
- Python 3.14, dependencies and environments managed with [uv](https://docs.astral.sh/uv/)
- FastAPI with async endpoints
- SQLAlchemy 2.0
- psycopg 3 driver
- Pydantic v2 for API schemas, pydantic-settings for configuration
- Alembic migrations, initialized with the async template (`alembic init -t async migrations`)
- Lint/format with ruff. Type checking with ty. Tests with pytest

### Frontend (`frontend/`)
- Next.js (App Router, TypeScript, Tailwind CSS, ESLint)

### Database and auth
- PostgreSQL 17 and Supabase Auth, run locally by the [Supabase CLI](https://supabase.com/docs/guides/local-development) (`supabase start`)

## Running locally

```sh
supabase start                                          # database, auth, Studio, Mailpit
docker compose up --build                               # API, web, Temporal, worker
docker compose run --rm api uv run python -m cli.seed   # first run only: seed the cities table
```

`supabase start` runs the data and auth layer (it must be up before `docker compose up`):
- Postgres on `localhost:54322` (user/password `postgres`, database `postgres`)
- Supabase API and Auth on <http://localhost:54321>
- Supabase Studio on <http://localhost:54323>
- Mailpit on <http://localhost:54324> - captures all email sent locally (signup confirmation, password reset, email change)

`docker compose up` runs the app services:
- API on <http://localhost:8000> (applies migrations on startup, hot reload)
- Web on <http://localhost:3000> (hot reload)
- Temporal on `localhost:7233` (UI on <http://localhost:8080>) and the sync worker

Tear down with `docker compose down` and, when done, `supabase stop`.

On a fresh database, seed the cities table once (downloads the current [GeoNames](https://download.geonames.org) dumps):

```sh
docker compose run --rm api uv run python -m cli.seed
```

Re-run the same command any time to refresh the city data.

Host ports are configurable, so a second app stack (e.g. from a git worktree) can run alongside the main one under its own project name; both share the single Supabase stack:

```sh
API_PORT=8001 WEB_PORT=3001 TEMPORAL_PORT=7234 TEMPORAL_UI_PORT=8081 docker compose -p my-branch up -d --build
docker compose -p my-branch down -v           # tear it down
```

Or, run `scripts/run-local.sh` from a worktree to copy `.env` from main (if missing) and launch the stack using available ports.

### Configuration and secrets

All configuration lives in a single `.env` at the repo root (`cp .env.example .env`). Defaults cover everything except secrets. See `.env.example` for details.

### Backend checks

```sh
cd backend
uv run ruff check .             # lint (add --fix to auto-fix)
uv run ruff format .            # format
uv run ty check                 # type check
uv run pytest                   # tests
```

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

Autogenerate-driven Alembic workflow. Migrations are forward-only: fix mistakes with a new revision, do not rely on downgrades.

```sh
cd backend
uv run alembic revision --autogenerate -m "describe the change"
# review the file in migrations/versions/, then:
uv run alembic upgrade head
```
