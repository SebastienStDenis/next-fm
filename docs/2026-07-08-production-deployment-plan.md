# Production deployment design

*Written 2026-07-08 by Claude (Opus 4.8).*

How this project goes from a dev-only `docker compose` stack to a real, live website
with signed-up users - which hosting services run each piece, how a user signs up
without us rolling our own auth, how it all deploys from the repo through GitHub
Actions, and how local development stays a faithful mirror of production. The guiding
constraints throughout are the ones this project has held from the start: keep it
lean and modern, don't build what a managed service already does well, and preserve
dev/prod parity so `docker compose up` behaves like the real thing.

This doc commits to a topology and sequences the work. It does **not** fully specify
the authentication implementation - that earns its own design doc - but it scopes
auth at the architecture level so the rest of the plan is coherent.

## Where we're starting from

Today the app is single-tenant and unauthenticated. `User` is just a row with a
`name` string and a `city_id`; anyone who can reach the API can act as any user by
putting a UUID in the path. There is no login, session, password, or token anywhere.
All playlists are written through a **single app-owned Spotify bot account** (one
shared `SPOTIFY_REFRESH_TOKEN`), which is a deliberate product decision, not an
accident of the prototype - users don't connect their own Spotify.

The stack is also dev-shaped: the `api` and `web` containers run development servers
(`uvicorn --reload`, `next dev`), migrations and a heavy city-seed run inline in the
`api` container's start command, Temporal is self-hosted via the
`temporalio/auto-setup` dev image, CORS is hardcoded to `localhost:3000`, and there
is no `.github/workflows/` at all. None of this is wrong - it is a good local
setup - but every one of those is a thing production needs to do differently.

## The production topology

```
                    ┌─────────────┐
   browser  ───────▶│   Vercel    │   Next.js frontend (server components + route
                    │  (frontend) │   handlers proxy to the API; browser only ever
                    └──────┬──────┘   talks to Next)
                           │ HTTPS
                    ┌──────▼──────────────────────┐
                    │           Render            │
                    │  ┌─────────┐   ┌──────────┐ │
                    │  │  api    │   │  worker  │ │  two services, one image
                    │  │(Web Svc)│   │(Bg Worker)│ │
                    │  └────┬────┘   └────┬─────┘ │
                    └───────┼─────────────┼───────┘
                            │             │
             ┌──────────────┼─────────────┼──────────────┐
             │              │             │              │
        ┌────▼─────┐   ┌────▼─────┐  ┌────▼──────────┐   │
        │ Supabase │   │ Supabase │  │ Temporal Cloud│   │
        │ Postgres │   │   Auth   │  │  (namespace)  │   │
        │ (app DB) │   │ (GoTrue) │  │               │   │
        └──────────┘   └──────────┘  └───────────────┘   │
                                                         │
   external: Last.fm · Bandsintown · MusicBrainz · Spotify (bot account)
```

| Component | Service | Launch cost |
|-----------|---------|-------------|
| Frontend (Next.js) | **Vercel** (Hobby) | $0 |
| Backend api + worker | **Render** (Web Service + Background Worker) | ~$14/mo |
| App database | **Supabase** Postgres | $0 (Free) |
| Signup / auth | **Supabase Auth** (GoTrue) | $0 |
| Durable orchestration | **Temporal Cloud** | $0 for 90 days, then $100/mo |
| CI | **GitHub Actions** | $0 |

## Decisions and rationale

### Frontend: Vercel

The frontend is Next.js; Vercel is its native home. Git-push deploys, preview
deployments per PR, and a free Hobby tier that comfortably covers a personal project.
Nothing here is contentious. Worth noting for the rest of the design: the frontend
reads the backend via `API_URL` **server-side** (no `NEXT_PUBLIC_` prefix), so the
browser only ever talks to Next, and Next talks to the API. That keeps the API off
the public browser surface and means CORS is a backend concern only for the handful
of direct calls.

### Backend (api + worker): Render, two services

The backend is two long-running processes built from one Docker image: the FastAPI
`api` (stateless HTTP) and the Temporal `worker` (`python -m app.worker`), which must
run **always-on** because Temporal is pull-based - the worker continuously long-polls
the task queue, and nothing runs unless a worker is polling. That always-on
requirement rules out serverless (Vercel) for the backend and rules out every
provider's free tier, which are built for scale-to-zero web apps that sleep when idle.

Render hosts both cleanly:

- `api` as a **Web Service**, `worker` as a **Background Worker** (a first-class
  service type with no HTTP port) - two entries in a single `render.yaml` blueprint
  checked into the repo, both building from `backend/Dockerfile`.
- Flat, predictable pricing (~$7/mo per Starter instance, ~$14/mo total), rather than
  a metered bill that an always-on worker would quietly run up.
- A **pre-deploy command** hook to run migrations once per deploy (see below).

We keep the two as **separate services** rather than collapsing them into one
container. It costs an extra ~$7/mo, but it buys the clean thing: the worker can be
scaled and restarted independently of the API (add worker replicas under sync load
without touching the web tier), each has its own logs and health, and a crash in one
doesn't take down the other. That independence is the reason Temporal splits
orchestration from execution in the first place; mirroring it in the deployment is
worth the price of a coffee per month.

*Alternatives considered.* **Railway** works and is slightly cheaper at low traffic,
but its metered model makes an always-on worker's bill less predictable.
**Fly.io** is a fine pay-per-second option, better suited to multi-region than we
need. **A single VPS** (Hetzner/DO) running the compose stack, or **Oracle Cloud's
always-free ARM VM** at $0, are the lean/ops-heavy end of the spectrum - genuinely
cheaper, and the right call *if* we self-host Temporal (which turns the backend into a
stateful 4-container stack that wants a box). With Temporal on Cloud, the backend is
just two stateless services, and a managed PaaS is the better fit. The VPS route is
documented as the future migration in "Self-hosting Temporal," below.

### App database: Supabase Postgres

Supabase is managed Postgres, and the app talks to it unchanged: `DATABASE_URL`
points at Supabase and Alembic + SQLAlchemy work exactly as they do locally. The app's
tables live in the `public` schema; Supabase Auth owns the `auth` schema; they don't
collide. Two connection details to get right:

- Use the Supabase **connection pooler** (Supavisor) connection string, not the raw
  database host. Our backend holds a long-lived async pool, so the session-mode
  pooler (or the direct connection) is appropriate. If we ever use the
  transaction-mode pooler, psycopg must be told to stop caching prepared statements
  (`prepare_threshold=None`), or it will error under pooling.
- The **Free tier pauses a project after 7 days of inactivity** and has no backups.
  That is fine for building. When the site is genuinely live, move to **Pro ($25/mo)**
  for an always-on database and backups. Not required to launch.

We picked Supabase over **Neon** (also excellent Postgres) precisely because it
*also* provides auth - one vendor instead of "Neon + a separate auth service."

### Signup / auth: Supabase Auth

We are not rolling our own auth, and we consolidate on the DB vendor: **Supabase
Auth** (GoTrue) gives email + Google/social login, 50,000 monthly active users on the
free tier, and - critically for our parity value - runs the *same* GoTrue engine
locally under `supabase start`. The shape:

1. The frontend uses the Supabase client to sign users up / in (email + Google). It
   receives a session containing a **JWT**.
2. The frontend sends that JWT as a `Bearer` token on calls to our API (for the few
   browser-direct routes; server components can attach it too).
3. The FastAPI backend **verifies the Supabase-issued JWT** in a dependency (via the
   project's JWT secret / JWKS) and resolves it to our `User` row. This replaces
   today's "trust any UUID in the path."

Two design points this raises, both deferred to the auth doc but flagged here:

- **Mapping identity to `User`.** The existing `User` row needs to be tied to a
  Supabase auth user (a stored `auth_id`/`supabase_user_id`, or adopting the Supabase
  user id as the primary key). On first login we create-or-link the `User`. The
  `LastfmConnection` linkage is unchanged - it stays a data linkage, not an auth
  mechanism.
- **The Spotify bot account is unchanged.** Auth here means "who is logged into *our*
  site," not "connect your Spotify." All playlists continue to be written through the
  single shared bot account. Whether users should eventually own playlists in their
  own Spotify is a separate product question (see "Open questions").

*Alternatives considered.* **Clerk** has the nicest Next.js DX but is a separate
vendor and bill with a lower free MAU ceiling; **Auth0** is heavier than this project
wants; **Auth.js/NextAuth** would mean managing more of the flow ourselves. Supabase
Auth wins on consolidation - it's already the database.

### Durable orchestration: Temporal Cloud (for now)

We keep Temporal - the durability, retries, resumability, and live progress UI it
gives the sync pipeline (`docs/2026-07-07-sync-orchestration-plan.md`) are real and
already built - and we run it on **Temporal Cloud** to launch. The entire dev/prod
switch already exists: setting `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and
`TEMPORAL_API_KEY` flips `connect_temporal()` onto the TLS + API-key Cloud path with
no code change, and the `temporal`/`temporal-ui` containers simply drop out of prod.

The honest cost picture: Temporal Cloud is **free for a 90-day trial**, then a **flat
$100/mo floor** (Essentials plan). Our usage sits far below the included 1M
Actions/month - a sync is ~15-25 Actions, so even fifty users syncing nightly is a
few percent of the allowance - which means we pay the *floor*, not consumption, and it
stays $100/mo until we have hundreds of active users. For a hobby-scale learning
project that is a lot for what a ~$5 VPS could self-host, so Cloud is explicitly the
**get-it-running-now** choice, with self-hosting documented as the planned exit when
the trial ends. Temporal Cloud earns its price when zero-ops matters more than money;
until then it buys us a clean launch.

### Background sync cadence: a Temporal Schedule, not separate cron

The eventual automatic re-sync (today sync is on-demand only, via the button) does
**not** need new infrastructure. It is a **Temporal Schedule** firing a dispatcher
workflow on a cadence that picks the stalest active users and starts each one's
`SyncUserWorkflow` with `USE_EXISTING` - exactly as sketched in the future-work
section of `docs/2026-07-07-sync-orchestration-plan.md`. It runs on the **same
always-on worker** we already pay for on Render; there is no separate cron service to
host. It needs the two small schema additions that doc names (a per-user active flag
and a `last_synced_at`). This is Phase 3 below, not launch.

## What has to change in the repo (the gaps)

Moving off the dev-shaped stack means closing a specific list of gaps:

- **Production images / commands.** The backend `Dockerfile`'s own `CMD` already runs
  uvicorn without `--reload` (the reload + bind-mounts come from the compose
  override), so the `api` service is close; the `worker` service just needs its
  command (`python -m app.worker`, no watchfiles) set in `render.yaml`. The frontend
  `Dockerfile` runs `npm run dev` and is **dev-only** - Vercel builds the frontend
  natively with `next build`/`next start` and never uses that Dockerfile.
- **Migrations as a deploy step, not an entrypoint.** Today `alembic upgrade head`
  runs inline in the `api` compose command. In production it becomes Render's
  **pre-deploy command** (`uv run alembic upgrade head`), so it runs **once per
  deploy** rather than in every replica's boot, and the worker never races it.
- **Trim the seed for production.** `python -m app.seed` upserts the entire GeoNames
  cities table on every boot (heavy) and inserts a demo "Ada Lovelace" user. The
  cities upsert should run as a one-shot/idempotent step (part of the pre-deploy or a
  manual job), and the demo user must not be seeded in production.
- **Parameterize CORS.** The hardcoded `allow_origins=["http://localhost:3000"]`
  becomes an env-driven list including the Vercel production origin.
- **Add authentication.** The single largest change, scoped above and specified in
  its own doc.

## Configuration and secrets

The single-root-`.env` model stays for local dev. In production, configuration moves
into each platform's own secret store - nothing secret is committed:

- **Render**: an env group holds `DATABASE_URL` (Supabase pooler), the `TEMPORAL_*`
  Cloud values, the `LASTFM`/`BANDSINTOWN`/`SPOTIFY_*` secrets, the Supabase
  JWT-verification secret, and the CORS origin list. Shared by both `api` and
  `worker`.
- **Vercel**: the Supabase URL + anon key (public, `NEXT_PUBLIC_`) and the server-side
  `API_URL` pointing at the Render API.
- **GitHub Actions**: only what CI needs (nothing production-secret for a
  test-only pipeline).

The `.env.example` grows the new keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, the
JWT secret, `CORS_ORIGINS`) so local setup stays copy-paste.

## Deployment and CI/CD

The split is: **GitHub Actions is the test gate; the platforms own the deploys.**

- **CI (GitHub Actions), on every PR:** backend `uv run ruff check`, `uv run ty
  check`, `uv run pytest`; frontend `npm run lint`, `npm run build`. This is the merge
  gate and the first `.github/workflows/` the repo has had.
- **Frontend CD:** Vercel's native Git integration auto-deploys `main` to production
  and every PR to a preview URL. No Actions wiring needed.
- **Backend CD:** the `render.yaml` blueprint auto-deploys `main` on push. The
  **pre-deploy command runs `alembic upgrade head`** before the new version goes live,
  so schema changes land exactly once per deploy.

This keeps deploys on the paved road (platform git integrations) and uses Actions for
what it's best at - gating merges - rather than hand-rolling deploy plumbing. If we
later want deploys gated on CI, Render/Vercel deploy hooks can be triggered from the
workflow instead of on raw push.

## Local development parity

Parity is a first-class goal, and the good news is most of it already holds. Two
services keep their local form, and one gains a local form:

- **Temporal stays self-hosted locally.** The existing `temporal` +
  `temporal-ui` compose services (auto-setup on the local Postgres) are unchanged;
  locally `TEMPORAL_API_KEY` is empty so `connect_temporal()` takes the plaintext
  path. Prod points the same vars at Cloud. Self-hosted locally, managed in prod,
  identical app code - the switch already built.
- **Supabase runs locally via its own CLI stack.** We use the sanctioned path -
  `supabase start` - rather than folding Supabase's images into our `docker-compose`.
  The CLI brings up Postgres + the same GoTrue auth engine *behind the same Kong
  gateway and keys as hosted*, so local JWTs are issued by identical software and
  `supabase-js` sees the identical `/auth/v1` URL structure - true parity, and the CLI
  owns the component versions and upgrades for us. Cherry-picking bare GoTrue into our
  compose was considered and rejected: it would mean re-implementing the gateway
  routing Supabase already gives us, for no real gain. Locally, `DATABASE_URL` and the
  Supabase URL/keys point at the CLI stack, and Alembic migrates it exactly as it
  migrates the cloud project. The accepted tax is that this is a **second set of
  containers** alongside the app compose (the CLI manages its own), so local dev is
  `supabase start` **and** `docker compose up` rather than a single command - a
  deliberate trade of one extra command for exact auth parity.
- **api / worker / web** run from the same compose definitions, against the local
  Supabase Postgres and local Temporal.

The net: the only things that differ between laptop and production are connection
strings and where TLS is on - which is exactly the parity bar this project set.

## Cost trajectory

| Phase | Monthly | Notes |
|-------|---------|-------|
| Launch (first 90 days) | **~$14** | Render only; Vercel + Supabase + Temporal all free |
| After the Temporal trial | **~$114** | +$100 Temporal Cloud - the trigger to either pay or self-host |
| Genuinely live / real users | **~$140-160** | +$25 Supabase Pro (no pausing, backups); maybe +$20 Vercel Pro |

The step from $14 to $114 is entirely the Temporal Cloud floor, and it is the moment
the "Self-hosting Temporal" migration below pays for itself.

## Implementation phases

**Phase 0 - production-ready repo.** Add `render.yaml` (api Web Service + worker
Background Worker, pre-deploy `alembic upgrade head`); set the worker's production
command; trim the seed (idempotent cities load, no demo user in prod); parameterize
CORS; add the GitHub Actions CI workflow. No new product behavior - just make the
stack deployable.

**Phase 1 - go live, unauthenticated.** Create the Supabase project and a Temporal
Cloud namespace; wire secrets into Render and Vercel; point `DATABASE_URL` at
Supabase and `TEMPORAL_*` at Cloud; deploy backend to Render and frontend to Vercel.
The existing app is now live on real infrastructure (still trusting UUIDs - internal
only until Phase 2).

**Phase 2 - authentication (own design doc).** Supabase Auth signup/login (email +
Google); backend JWT-verification dependency; map Supabase identity to `User`
(create-or-link on first login); replace path-UUID trust; lock down CORS. This is what
makes a public signup safe.

**Phase 3 - scheduled sync cadence.** Add the `last_synced_at` + active-user schema
fields; a Temporal Schedule + dispatcher workflow that re-syncs the stalest users on
the existing worker (`docs/2026-07-07-sync-orchestration-plan.md`).

**Phase 4 (when the trial ends) - self-host Temporal, if the cost warrants.** See
below.

## Self-hosting Temporal (the documented exit)

When the 90-day trial ends, $100/mo is the signal to weigh self-hosting. It is a
bounded, single-node job at our scale: run the `temporalio/server` image as an
always-on **private** service (frontend gRPC never public, so no auth/mTLS needed),
back it with a **dedicated Postgres** (Temporal needs its own `temporal` +
`temporal_visibility` databases, which Supabase won't host), use **Postgres-based
visibility** (no Elasticsearch since Temporal 1.20), and run the schema tool once
(and on version upgrades). Because that adds a stateful 4-container stack, the natural
home shifts from Render to a **single VPS running the compose file** (Hetzner ~€4.50,
DO $6, or Oracle's always-free ARM VM at $0) - the topology that mirrors local most
closely. Flipping back is again just the `TEMPORAL_*` env vars. This is also the most
educational path, which is a stated goal of the project - so it is a deliberate
"later," not a "never."

## Open questions

- **Per-user Spotify.** Every playlist is written through one shared bot account
  today. If the product ever wants users to own the playlist in *their own* Spotify,
  that is a per-user OAuth flow and a real design change - orthogonal to app-login
  auth, and out of scope here.
