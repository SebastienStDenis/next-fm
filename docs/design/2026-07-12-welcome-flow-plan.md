# Guided welcome flow

*Written 2026-07-12 by Claude (Fable 5).*

## Problem

A new user lands on an empty dashboard and has to discover, via attention
dots and empty-state nudges, that they must open Settings, link a Last.fm
account, set a home city, and run a manual sync before anything appears.
That scattered treasure hunt is replaced by a guided first-login flow, and
the half-set-up states it produced are ruled out entirely.

## Invariant

The dashboard requires a home city and a sync on record - even a failed
one. Anyone short of that is redirected to the welcome flow; there is no
skipping. This lets the dashboard and settings drop every "no home city" and
"never synced" half-state: events are always fetched, the concerts and
playlists tabs lose their set-a-city empty states, the sync gate reduces to
"is Last.fm linked", and the home city becomes a quiet, never-clearable
field in the settings Account section instead of its own alert-bearing
section. The Last.fm link is likewise change-only - no unlink control
anywhere; only deleting the whole account removes it.

"A sync on record" is read from `GET /me/sync`, with `last_synced_at` as a
fallback: Temporal retention can expire an old run's history, so a stamped
successful sync also counts, and an unknown status (Temporal unreachable)
never bounces. The cost of the invariant: a visitor without a Last.fm
account cannot get past onboarding - accepted, since every dashboard tab is
sync-fed and useless without one.

## Flow

`/welcome` (`frontend/src/app/welcome/page.tsx`) is the settings cards,
unchanged, in setup order - the guided feel comes from state marks on the
section headings (one pulsing attention dot on the step to do now, a green
check on completed ones), not custom machinery:

1. **Last.fm** - the settings panel; `PUT /me/lastfm` validates the
   account and the card shows it.
2. **Home City** - the settings panel and its city search; `PUT /me/city`.
3. **First Sync** - the Daily Sync card retitled for the one-off: its
   manual run control starts the sync (deliberately not automatic -
   pressing it is what teaches that playlists come from a sync), the
   one-line playback shows the run live, and afterwards the step list -
   kept expanded on this page - shows the summaries or the failure. A
   re-run after a failure is the card's normal retry.

Shared actions revalidate the root layout so the welcome and dashboard
server payloads both refresh as setup progresses. When a run finishes the
card refreshes the route, and a successful sync reveals the completion
footer: "All set. Playlists update daily." beside a go-to-dashboard button.
The handoff is deliberately a click, not a redirect - the user gets a
moment with the finished step list before moving on.

Copy and section names follow `docs/wording.md` (Welcome flow section).

## Routing

- The dashboard redirects to `/welcome` whenever the invariant fails. All
  post-login entry points funnel through the dashboard, so no auth redirect
  changes.
- `/welcome` never redirects away: mid-setup and mid-first-sync it resumes
  where the user left off, and once a sync has succeeded it shows the
  completion footer. Nothing links to it afterwards, so onboarded users
  only see it again by typing the URL.

## Details

- No backend changes: first-run state is inferred from existing endpoints,
  and the sync-start guards (404 without Last.fm or city) hold because the
  sync card disables its control until both are set.
- The settings section card lives in
  `frontend/src/app/dashboard/section.tsx` and the sync step pieces (types,
  marks, list, one-line playback, status fetch) in
  `frontend/src/app/dashboard/sync-steps.tsx`, both shared by the settings
  dialog and the welcome page.
- Nothing auto-starts: the sync card's manual control is the only trigger,
  and the backend attaches to an in-flight run rather than stacking one.
- Corrections are the panels' own change controls, the same as in
  settings; the Last.fm link and home city can be changed but never
  removed.
