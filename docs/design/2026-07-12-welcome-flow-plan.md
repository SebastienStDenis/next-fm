# Guided welcome flow

*Written 2026-07-12 by Claude (Fable 5).*

## Problem

A new user lands on an empty dashboard and has to discover, via attention
dots and empty-state nudges, that they must open Settings, link a Last.fm
account, set a home city, and run a manual sync before anything appears.
That scattered treasure hunt is replaced by a guided first-login flow.

## Flow

`/welcome` (`frontend/src/app/welcome/`) walks the three requirements in
order, one active step at a time with completed steps collapsing to a
check-marked summary line:

1. **Last.fm** - username input; `PUT /me/lastfm` validates the account and
   the flow shows the linked username.
2. **Home City** - the same city search box the settings dialog uses;
   `PUT /me/city`.
3. **First Sync** - starts automatically once both are set
   (`POST /me/sync`) and shows the four workflow steps live by polling
   `GET /me/sync`, ending in a "Go to dashboard" button (or a retry on
   failure).

Copy and step names follow `docs/wording.md` (Welcome flow section).

## Routing

- The dashboard redirects to `/welcome` when setup is incomplete (no Last.fm
  link or no home city), the user has never completed a sync
  (`last_synced_at` null), and the skip cookie is absent. All post-login
  entry points funnel through the dashboard, so no auth redirect changes.
- "Skip for now" sets the `welcome-skipped` cookie
  (`frontend/src/app/welcome/welcome-cookie.ts`, one year) client-side, like
  the dashboard tab cookie, and returns to the dashboard where the existing
  settings nudges take over.
- `/welcome` itself bounces fully onboarded users (setup complete and a
  completed sync on record) to the dashboard, so the flow stays resumable
  mid-setup or mid-first-sync but never reappears afterwards.

## Details

- No backend changes: first-run state is inferred from existing endpoints,
  and the sync-start guards (404 without Last.fm or city) are satisfied by
  the step order.
- The sync step list (types, marks, list, status fetch) moved from
  `sync-card.tsx` into `frontend/src/app/dashboard/sync-steps.tsx`, shared
  by the settings sync card and the welcome flow. The card's one-line
  playback (`CurrentStep`) stays in the card; the flow shows the full list.
- A sync already on record is never auto-restarted: a running one is
  attached to and watched, a failed one shows "Try again".
- Corrections during setup reopen a completed step (pencil), but only until
  the first sync starts; after that, changes belong to the settings dialog.
