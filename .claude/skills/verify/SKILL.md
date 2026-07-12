---
name: verify
description: Build, run, and drive this app end-to-end to verify a change at its surface (browser for frontend, HTTP for backend).
---

# Verifying changes in next-fm

## Handles

Prereq: `supabase start` stack must already be running (`supabase status` from
the repo root prints keys and URLs; the local demo keys are public).

Frontend dev server, from `frontend/` (defaults target the local Supabase CLI
stack, no env file needed):

```sh
PORT=3002 API_URL=http://localhost:8002 npm run dev
```

Backend API, from `backend/` (root `.env` must exist; its `DATABASE_URL` may
point at the compose-internal host, so override it):

```sh
DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres" \
  uv run uvicorn app.main:app --port 8002
```

Run both yourself on spare ports rather than reusing containers on :3000/:8000 —
those may be serving a different checkout, and their API can 500 on schema
drift against the shared database (e.g. a model column with no migration yet).

## Test users

Create a pre-confirmed user via the Supabase admin API (service-role key from
`supabase status`):

```sh
curl -X POST "http://127.0.0.1:54321/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"...","password":"...","email_confirm":true,"user_metadata":{"display_name":"..."}}'
```

The backend auto-creates its user row on first authenticated request, so a
fresh auth user can log in and load the dashboard immediately.

## Driving the browser

Playwright works with the locally cached Chromium (`npm install playwright` in
a scratch dir, no browser download needed if `~/Library/Caches/ms-playwright`
is populated). Form fields use `input[name="email"]` / `input[name="password"]`;
buttons and links are reachable by role and visible text ("Log in", "Sign up",
"Sign out" in the settings dialog at /dashboard#settings).

Gotchas:

- The running local Supabase stack may auto-confirm signups even though
  `supabase/config.toml` says `enable_confirmations = true` (config is baked at
  `supabase start` time), so `signUp` can land on /dashboard instead of
  /signup/check-email.
- The proxy redirects unauthenticated app pages to `/` and authenticated
  /login`/`/signup to /dashboard; after any server action the router cache is
  purged, so history back-navigation refetches and follows these redirects.
