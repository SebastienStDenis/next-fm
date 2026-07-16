import type { init } from "@sentry/nextjs";

/**
 * The options every runtime shares. Next.js initializes Sentry three times -
 * browser, node, and edge - and drift between those inits is invisible until
 * one of them silently stops reporting.
 *
 * A DSN is public by design (it ships inside the browser bundle), so all three
 * read the same `NEXT_PUBLIC_` variable rather than making Vercel hold two
 * copies of one value. Leaving it unset disables Sentry, which is what local
 * development wants.
 */
export const sharedOptions: Parameters<typeof init>[0] = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Left to its default the SDK tags Vercel events `vercel-production` /
  // `vercel-preview`, which does not match the backend's `production`. A Sentry
  // issue alert filters to a single environment, so no one value covers both
  // projects' production at once. Setting it from NEXT_PUBLIC_VERCEL_ENV (which
  // Vercel exposes per deployment, inlined into all three runtimes) normalizes
  // the frontend to `production` / `preview`, so the single combined alert can
  // filter to `environment:production` across api, worker, and frontend and
  // leave previews out. Unset locally, where the DSN is off anyway, so it falls
  // back to `development`.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  // Errors and logs only. Tracing bills per span and answers "how slow is
  // this", which is not a question this app is asking yet. Raising it above 0
  // is also what would link logs to traces.
  tracesSampleRate: 0,
  enableLogs: true,
};
