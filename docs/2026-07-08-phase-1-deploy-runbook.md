# Phase 1 deploy runbook: go live, unauthenticated

*Written 2026-07-08 by Claude (Opus 4.8).*

The step-by-step for Phase 1 of `docs/2026-07-08-production-deployment-plan.md`:
stand up the real infrastructure and deploy, still trusting UUIDs (no auth -
that's Phase 2). Every step here is a signup or a dashboard action **you** run;
the repo side (`render.yaml`, CI, the pooler toggle) is already in place. Work
top to bottom - the order respects the dependencies between services.

What Phase 1 does **not** include: Supabase **Auth**. Phase 1 uses Supabase only
as **Postgres**. The app connects to it through `DATABASE_URL` exactly as it
connects to the local compose Postgres - no auth code, no login. GoTrue/JWTs are
Phase 2.

## Accounts to create

| Service | Plan for launch | Notes |
|---------|-----------------|-------|
| [Supabase](https://supabase.com) | Free | pauses after 7 days idle, no backups - fine for now |
| [Temporal Cloud](https://temporal.io/cloud) | Free 90-day trial | then $100/mo (the Phase 4 self-host trigger) |
| [Render](https://render.com) | Starter ×2 (~$14/mo) | **the one paid commitment**; needed for always-on worker + pre-deploy |
| [Vercel](https://vercel.com) | Hobby (Free) | connect the same GitHub repo |

## 1. Supabase (Postgres)

1. Create a new project. Pick a region near the Render region you'll use in
   step 3 (Oregon → US West). Save the database password.
2. Get the connection string: **Project Settings → Database → Connection string
   → "Connection pooling"**, and pick **Session mode** (host on port `5432`).
   It looks like:
   ```
   postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres
   ```
   Swap the scheme to what the app expects (psycopg 3, async):
   ```
   postgresql+psycopg://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres
   ```
   That is the `DATABASE_URL`.
   - Session mode keeps prepared statements working, so leave
     `DATABASE_DISABLE_PREPARED_STATEMENTS=false`.
   - If you deliberately choose the **transaction**-mode pooler instead (port
     `6543`), set `DATABASE_DISABLE_PREPARED_STATEMENTS=true`. That's the only
     reason the toggle exists.
3. Nothing to migrate by hand - Render's pre-deploy runs `alembic upgrade head`
   and loads cities on first deploy (step 3).

## 2. Temporal Cloud (namespace)

1. Create an account and a **namespace**. Note its full name, which includes
   your account id: `<namespace>.<account-id>`.
2. Under the namespace, generate an **API key**. Copy it now - it's shown once.
3. From the namespace overview, copy the **gRPC endpoint** (host:port, port
   `7233`). These three become:
   - `TEMPORAL_NAMESPACE` = `<namespace>.<account-id>`
   - `TEMPORAL_ADDRESS` = the gRPC endpoint
   - `TEMPORAL_API_KEY` = the key
   Setting `TEMPORAL_API_KEY` is the entire switch - `connect_temporal()` flips
   to the TLS + API-key Cloud path automatically. Keep
   `TEMPORAL_TASK_QUEUE=user-sync`.

## 3. Render (api + worker)

1. **Create the env group first** (the blueprint references it by name).
   **Dashboard → Env Groups → New**, name it exactly `live-playlists`, and add:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | from step 1 |
   | `DATABASE_DISABLE_PREPARED_STATEMENTS` | `false` (or `true` for the txn pooler) |
   | `TEMPORAL_ADDRESS` | from step 2 |
   | `TEMPORAL_NAMESPACE` | from step 2 |
   | `TEMPORAL_TASK_QUEUE` | `user-sync` |
   | `TEMPORAL_API_KEY` | from step 2 |
   | `LASTFM_API_KEY` | your key |
   | `BANDSINTOWN_API_KEY` | your key |
   | `SPOTIFY_CLIENT_ID` | your value |
   | `SPOTIFY_CLIENT_SECRET` | your value |
   | `SPOTIFY_REFRESH_TOKEN` | your value (from `python -m app.spotify_auth`) |
   | `CORS_ORIGINS` | set after step 4 (Vercel URL); `*` temporarily if you want the first deploy green |

2. **Dashboard → New → Blueprint**, connect the GitHub repo. Render reads
   `render.yaml` and creates `live-playlists-api` (Web Service) and
   `live-playlists-worker` (Background Worker), both linked to the env group.
3. Deploy. The api's pre-deploy runs migrations + the cities load once; then the
   api and worker start. Grab the api URL: `https://live-playlists-api.onrender.com`.

## 4. Vercel (frontend)

1. **New Project → import the same repo.** Set **Root Directory** to `frontend`
   (framework auto-detects as Next.js). Vercel builds natively with
   `next build` - it never uses `frontend/Dockerfile`.
2. Add one env var: `API_URL` = the Render api URL from step 3. Keep it a plain
   var (no `NEXT_PUBLIC_` prefix) - the frontend reads the API server-side only,
   so the browser never sees it.
3. Deploy. Note the production URL: `https://<app>.vercel.app`.

## 5. Close the loop

1. Back in the Render `live-playlists` env group, set `CORS_ORIGINS` to the
   Vercel URL from step 4 (comma-separate if you add a custom domain later).
   Save - Render redeploys the api with the real origin.
2. Vercel auto-deploys `main` to production and every PR to a preview URL;
   Render auto-deploys `main` on push. No further wiring.

## Post-deploy checks

- `GET https://live-playlists-api.onrender.com/health` → `{"status":"ok"}`
  (confirms api ↔ Supabase).
- The Render **worker** logs show `Worker polling task queue 'user-sync'`
  (confirms worker ↔ Temporal Cloud).
- Open the Vercel URL, create a user, link a Last.fm account, and run a sync -
  the run should appear in the Temporal Cloud UI.

## Reminder: this is internal-only until Phase 2

The live site trusts any UUID in the path - anyone with a user's id can act as
them. Keep the URL unshared until Phase 2 adds authentication. See
`docs/2026-07-08-production-deployment-plan.md` for the phase map.
