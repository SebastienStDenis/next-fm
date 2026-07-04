# live-playlists

Full-stack monorepo: FastAPI backend, Next.js frontend, Postgres database, Docker for local development.

## Stack

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

Endpoints:
- `GET /health` - API + database health check
- `GET /users` - list users
- `GET /users/{id}` - fetch one user
- <http://localhost:3000/users> - web page listing all users

### Running the backend outside Docker

```sh
cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run python -m app.seed
uv run uvicorn app.main:app --reload
```

Requires Postgres running (e.g. `docker compose up db`).

### Backend checks

```sh
cd backend
uv run ruff check .
uv run ruff format --check .
uv run ty check
uv run pytest
```

Tests hit the real API app, which requires the database to be up.

### Frontend

```sh
cd frontend
npm install
npm run dev
npm run lint
```

## Migrations

Autogenerate-driven Alembic workflow. Review every generated migration before applying. Migrations are forward-only: fix mistakes with a new revision, do not rely on downgrades.

```sh
cd backend
uv run alembic revision --autogenerate -m "describe the change"
# review the file in migrations/versions/, then:
uv run alembic upgrade head
```
