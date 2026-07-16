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
  // Errors and logs only. Tracing bills per span and answers "how slow is
  // this", which is not a question this app is asking yet. Raising it above 0
  // is also what would link logs to traces.
  tracesSampleRate: 0,
  enableLogs: true,
};
