# Guided welcome flow

*Written 2026-07-12 by Claude (Fable 5).*

## Problem

A new user lands on an empty dashboard and has to discover, via attention
dots and empty-state nudges, that they must open Settings, link a Last.fm
account, set a home city, and run a manual sync before anything appears.
That scattered treasure hunt is replaced by a guided first-login flow, and
the half-set-up states it produced are ruled out entirely.

## Invariant

The dashboard requires a linked Last.fm account, a home city and a
successful sync. Anyone short of that is redirected to the welcome flow;
there is no skipping. This lets the dashboard and settings drop every "no
home city" and "never synced" half-state: events are always fetched, the
concerts and playlists tabs lose their set-a-city empty states, the sync
gate reduces to "is Last.fm linked", and the home city becomes a quiet,
never-clearable field in the settings Account section instead of its own
alert-bearing section. The Last.fm link is likewise change-only - no unlink
control anywhere; only deleting the whole account removes it.

A *successful* sync, not merely a run on record, is the bar - read from
`last_synced_at`, the durable DB stamp the workflow writes only after every
step succeeds (see Completion footer). An earlier draft admitted anyone who
had run a sync, even a failed one, but that readmits exactly the empty-
dashboard half-state the flow exists to remove: a failed run syncs nothing,
so a failed-only user gains an empty dashboard. Holding them on the welcome
flow - where the card shows the failure and its retry - is both more honest
and the flow's whole point. Keying off the stamp (not `GET /me/sync`) also
sidesteps Temporal: retention can expire a run's history and the server can
be unreachable, but the stamp stands regardless, and it makes the redirect
the exact inverse of the welcome footer's reveal gate, so the two can never
disagree on whether a user is onboarded. The cost of the invariant: a
visitor without a Last.fm account or a working first sync cannot reach the
dashboard - accepted, since every dashboard tab is sync-fed and useless
without one.

## Flow

`/welcome` (`frontend/src/app/welcome/page.tsx`) is the settings cards,
unchanged, in setup order - the guided feel comes from state marks on the
section headings (one pulsing attention dot on the step to do now, a green
check on completed ones), not custom machinery:

1. **Last.fm** - the settings panel; `PUT /me/lastfm` validates the
   account and the card shows it.
2. **Home City** - the settings panel and its city search; `PUT /me/city`.
3. **Daily Sync** - the settings sync card, named for the cadence even on
   the first run: its manual run control starts the sync (deliberately not
   automatic - pressing it is what teaches that playlists come from a
   sync, the same one that then repeats daily), the one-line playback
   shows the run live, and afterwards the expandable step list holds the
   summaries or the failure. A re-run after a failure is the card's normal
   retry.

Shared actions revalidate the root layout so the welcome and dashboard
server payloads both refresh as setup progresses. When a run finishes the
card refreshes the route, and a successful sync reveals the completion
footer: "All set. Playlists update daily." beside a go-to-dashboard button.
The handoff is deliberately a click, not a redirect - the user gets a
moment with the finished step list before moving on.

Copy and section names follow `docs/wording.md` (Welcome flow section).

## Completion footer

The footer ("All set. Playlists update daily." beside a go-to-dashboard
button) reveals only after a *successful* sync, and only once the sync card
has finished replaying its steps - not the instant the finishing run's
refresh lands.

- **Never on a failed run.** The reveal keys off `last_synced_at`, which the
  workflow stamps only after every step succeeds (the `record_sync_completed`
  activity, reached only when no step raised); a failed run never stamps it
  and never clears an existing stamp. So a failed *first* run shows no footer
  - the user stays on `/welcome` and re-runs, the card's normal retry. A
  failed *later* run leaves the earlier success's footer in place, since the
  stamp still stands.
- **Waits for playback.** When a run finishes the card sets a `settling` flag
  and refreshes the route; the server re-renders with the stamp set, but the
  footer holds back until the step playback settles. The welcome page learns
  the card is mid-playback through a small `SyncActivityContext`
  (`frontend/src/app/dashboard/sync-activity.tsx`) the card reports into - a
  no-op on the dashboard, which has no footer. The reveal lives in
  `frontend/src/app/welcome/welcome-flow.tsx`, a client wrapper around the
  setup sections and the footer.
- **Latched, so re-runs don't disturb it.** Once revealed the footer stays: a
  manual re-run, or one that fails, must not collapse it and replay the
  reveal. Two things guarantee this. The durable fact is `last_synced_at` in
  the database, re-read on every render, so the footer survives soft refreshes
  and full reloads alike. A client-side latch additionally holds it across the
  card's in-session re-run playback (client state survives the soft
  `router.refresh()`); it resets on a full reload, but harmlessly, since a
  fresh load with no run replaying shows the footer straight away. The footer
  hides again only if a setup step reopens (Last.fm or home city gone), which
  the invariant's no-removal rule prevents in practice.

The dashboard redirect and this footer share one gate: both key off a
Last.fm link, a home city and a stamped `last_synced_at`, and the footer's
`ready` is the exact inverse of the redirect condition. So there is no window
where one treats a user as onboarded and the other doesn't - a failed-only
user is held on the welcome flow and shown no footer, never half-admitted to
an empty dashboard. See the Invariant.

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
