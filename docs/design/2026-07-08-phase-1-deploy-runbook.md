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
   step 3 - keep them together to cut api↔DB latency. This deployment uses
   Render **Ohio** (US East, AWS `us-east-2`), so put Supabase in `us-east-2`
   too. Save the database password.
2. Security settings (offered at creation, or later under **Settings → API**).
   The app talks to Postgres directly over `DATABASE_URL` and never uses
   Supabase's Data API (PostgREST), so:
   - **Enable Data API → off.** Removes the public REST exposure of the `public`
     schema. Does not affect the direct database connection.
   - **Automatically expose new tables → off.** Moot with the Data API off; off
     is the safe posture regardless.
   - **Enable automatic RLS → on.** Free defense-in-depth. The connection uses a
     role that bypasses RLS, so backend queries and Alembic migrations are
     unaffected - RLS only ever guards the (now disabled) Data API path.
3. Get the connection string from the green **Connect** button at the top of the
   dashboard. Open the **Direct** tab - it has three sub-sections. Copy the
   **Session pooler** string (host `...pooler.supabase.com`, port `5432`): it's
   IPv4 (works on Render) and, being session mode, keeps prepared statements
   working. Ignore **Direct connection** (IPv6-only without the paid IPv4
   add-on) and **Transaction pooler** (port `6543`).

   Fill in the password and swap the scheme to psycopg 3 (async):
   ```
   postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   That is the `DATABASE_URL`, and it pairs with
   `DATABASE_DISABLE_PREPARED_STATEMENTS=false` (session mode keeps prepared
   statements working). You would only flip that to `true` if you had picked the
   transaction pooler instead - which you did not, so it stays `false`.
4. Nothing to migrate by hand - Render's pre-deploy runs `alembic upgrade head`
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
   | `DATABASE_DISABLE_PREPARED_STATEMENTS` | `false` |
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

1. **New Project → import the same repo.** Set two settings explicitly:
   - **Root Directory** → `frontend` (scopes the project to the Next.js app).
   - **Framework Preset** → **Next.js**. Set it by hand; don't trust
     auto-detect. If it's left on "Other," the build fails with
     `No Output Directory named "public" found` - the symptom of Vercel not
     treating it as Next.js (Next outputs `.next`, not `public`). Leave Output
     Directory empty/default.

   Vercel builds natively with `next build` - it never uses `frontend/Dockerfile`.
   - Vercel's import will also detect the Python `backend/` and offer to set it
     up. **Ignore it** - do not create a project for the backend. Scoping to
     `frontend` drops the backend detection. The backend runs on Render (step 3);
     it can't run on Vercel because the always-on Temporal worker rules out
     serverless.
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
