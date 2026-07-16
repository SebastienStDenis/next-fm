# Operations

*Written 2026-07-15 by Claude (Opus 4.8), updated 2026-07-16.*

How you find out something broke, and what to do about it. Introduced by the
Sentry wiring in `backend/app/observability.py`; keep this doc current as the
alerting changes.

The one-shot infrastructure setup lives in
`docs/design/2026-07-08-phase-1-deploy-runbook.md` (written against the older
`live-playlists-*` service names). This doc is the ongoing side.

## Where failures surface

Nothing here overlaps: each failure has exactly one place that tells you, and
usually a different place where you debug it.

| Failure | Alerts via | Investigate in |
| --- | --- | --- |
| Any exception (api, worker, frontend) | Sentry → Slack | Sentry |
| Upstream API error (Last.fm, Spotify, Bandsintown, MusicBrainz) | Sentry → Slack | Sentry |
| Postgres / pooler failure | Sentry → Slack | Supabase dashboard |
| Sync step failure | Sentry → Slack | Temporal Cloud (which step, how many retries) |
| Worker crash / restart loop | Sentry → Slack | Render logs |
| Worker OOM | Render → Slack | Render |
| Deploy failure | Render → Slack | Render |
| Frontend build failure | Vercel → Slack | Vercel |
| Nightly schedule stops firing | **nothing** - see [Known gaps](#known-gaps) | - |

Sentry tells you something broke; it rarely tells you why. For a failed sync
the story is in Temporal Cloud's workflow history - every activity attempt, its
input, and its retry count.

## Where the logs are

`configure_observability()` (`backend/app/observability.py`) sends every
`app.*` record to two places. Both are useful for different things.

- **Render** - the raw stdout of `next-fm-api` and `next-fm-worker`, one stream
  per service. Retention depends on the *workspace* plan, not the service plan.
- **Sentry** (Explore → Logs) - the same records, plus 30-day retention, both
  services searchable together, and the run-up to any error attached to the
  issue as breadcrumbs.

This is deliberate duplication, not a migration: Render captures stdout whether
Sentry exists or not.

Frontend logs are wired (`consoleLoggingIntegration` in
`frontend/src/sentry.shared.ts` and the three runtime configs) but near-silent,
because nothing in `frontend/src` calls `console.*`. The first one added starts
flowing with no further setup. Vercel's own runtime logs keep 1 hour on Hobby
and 1 day on Pro, which is why Sentry is the better place to look.

## How reporting is wired

- **Sentry reports at WARNING, not its ERROR default.** WARNING is the level
  this codebase logs real failures at - a broken upstream, a failed sync step, a
  missing API key. At the default, almost nothing would be reported.
- **Sync steps report the original exception, not the wrapper.** The
  `_user_facing_errors` funnel (`backend/app/sync_activities.py`) logs with
  `exc_info` *before* re-raising as `ApplicationError`, so Sentry receives the
  real cause and its stack. Distinct causes stay distinct issues instead of
  collapsing into one issue per step. This is also why there is deliberately no
  Temporal interceptor: it would double-report every sync failure, once as the
  real exception and once as the user-facing message.
- **The api and worker share one DSN**, told apart by the `component` tag
  (`api` / `worker`). One project, two processes.
- **Tracing is off** (`traces_sample_rate=0`) on both sides. It bills per span
  and answers "how slow is this", which is not a question this app is asking.
  Turning it on is also what would link logs to traces.
- **Errors carry the deploy that caused them.** Render sets
  `RENDER_GIT_COMMIT`; Sentry reports it as the release.

## Gotchas

Three things that look like broken wiring and are not.

- **`onRequestError` never fires under `next dev`.** Frontend server errors only
  report from a production build. Testing with `npm run dev` will show nothing
  in Sentry and prove nothing.
- **Render will not alert on a worker crash loop.** `backend/app/worker.py`
  supervises itself: a crash is caught, logged, and retried in-process, so the
  process never dies and Render sees a healthy service. That `logger.exception`
  clears the WARNING threshold, so Sentry is the crash-loop detector here.
  Render still catches OOM, because the kernel kills the process outright.
- **Frontend stack traces are minified** (`app:///_next/server/chunks/…`) unless
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set in Vercel.
  `withSentryConfig` skips the source-map upload silently without them, so the
  build succeeds either way and the failure is invisible until you read a trace.

## Runbooks

### The Spotify refresh token expired

**Symptom:** a Sentry issue for `SpotifyAuthError`, and playlist syncs failing
with "Spotify is temporarily unavailable". **Spotify expires refresh tokens
after 6 months**, so this is recurring, not a one-off. The token is
operator-only: users can do nothing but wait.

Re-authorize as the bot account, from `backend/`:

```sh
uv run python -m app.spotify_auth
```

The script prints an authorize URL, and its own steps. In short:

1. Confirm `http://127.0.0.1:8765/callback` is listed under the app's Redirect
   URIs in the Spotify developer dashboard.
2. Open the printed URL in a browser **logged in as the bot account** - not your
   personal account. This is the step that quietly ruins the token if you get it
   wrong.
3. Approve. The browser lands on an unreachable `127.0.0.1:8765/callback?code=…`
   page. Copy that whole URL from the address bar and paste it back.
4. The script prints `SPOTIFY_REFRESH_TOKEN=…`.

Then, and the script does not say this - it only mentions `.env`:

- **Locally**: put it in the root `.env`.
- **In production**: put it in the Render **`next-fm` env group**, then redeploy
  **both** `next-fm-api` and `next-fm-worker`. Env group changes do not reach a
  running process on their own, and the worker is the one that actually writes
  playlists.

It needs `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` set first, and requests
the `playlist-modify-public` (create and write the public playlists) and
`playlist-read-private` (list the bot's own playlists for the orphan audit)
scopes. Scopes are baked into the refresh token, so widening them means
re-running this flow, not just editing the code.

### A sync is failing for one user

Sentry names the exception; Temporal Cloud has the history. Find the workflow by
its id (`user_sync_workflow_id`, in `backend/app/sync_workflow.py`) and read the
failed activity's attempts. Retries are capped at 3, with `SpotifyAuthError` and
`LastfmPrivateDataError` marked non-retryable, so a permanent failure means the
cause is real and not transient.

## Known gaps

- **A nightly schedule that stops firing alerts nobody.** Nothing throws, so
  nothing reports. Sentry's Cron Monitors would close this natively:
  `DispatchSyncsWorkflow` checks in each night, and Sentry opens an issue when a
  check-in fails to arrive. Deliberately not wired yet.
- **Supabase's own health** has no alert path. Its failures surface only as
  exceptions in the backend, which is enough in practice - the July 2026 pooler
  outage would have hit Slack as `EMAXCONNSESSION` errors.

## Dashboard configuration

Not in the repo; recorded here so it can be rebuilt.

**Sentry** (org `next-fm`, free Developer plan - 5k errors/month, 5GB logs,
30-day retention). Two projects, because a project maps to a deployed codebase
and not to a service you depend on. Temporal Cloud and Supabase get none.

| Project | Platform | Covers |
| --- | --- | --- |
| `backend` | FastAPI | `next-fm-api` **and** `next-fm-worker` |
| `frontend` | Next.js | the Vercel app (browser, server, edge) |

One issue alert spans both projects and posts to Slack, triggering on: a new
issue is created, a resolved issue becomes unresolved, an issue escalates. The
regression trigger matters - without it, resolving an issue mutes it forever.
Each project also keeps Sentry's default email alert for high-priority issues, a
subset of the above.

**The alert is scoped to `environment:production`.** The api/worker tag events
via `SENTRY_ENVIRONMENT` on Render; the frontend sets `environment` from
`NEXT_PUBLIC_VERCEL_ENV` in `sentry.shared.ts`. That explicit frontend tag is
what makes one combined rule possible: left to its default the SDK tags Vercel
events `vercel-production` / `vercel-preview`, which does not match the backend's
`production`, and a Sentry issue alert filters to a single environment - so no
one value would cover both projects' production at once. Normalizing the frontend
to `production` / `preview` lets a single `environment:production` filter cover
api, worker, and frontend prod while leaving previews out. Preview errors still
land in Sentry for debugging; they just do not alert.

Sentry's environment filter lists every environment it has ever ingested and
never prunes them, so stale values linger there - `vercel-production`,
`vercel-preview` (the SDK's old default, superseded by the above) and any one-off
like `prod`. Pick `production`; ignore the rest.

**Render**: notification destination Slack, default "Only failure
notifications". Env group `next-fm` holds `SENTRY_DSN` and `SENTRY_ENVIRONMENT`;
`SENTRY_ORG`/`SENTRY_PROJECT` are not needed, as Python has no source maps and
the DSN carries its own routing.

**Vercel**: notifications on for failed deploys. Env vars
`NEXT_PUBLIC_SENTRY_DSN` (public by design - it ships in the browser bundle;
do not mark it sensitive) plus `SENTRY_ORG`, `SENTRY_PROJECT`, and
`SENTRY_AUTH_TOKEN` (a real secret - mark it sensitive). The environment tag
comes from `NEXT_PUBLIC_VERCEL_ENV`, a Vercel system variable exposed
automatically per deployment, so no env var holds it by hand.
