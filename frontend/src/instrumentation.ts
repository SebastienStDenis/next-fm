import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Server Components render on the server, so this - not the browser SDK - is
// what reports a page that fails while fetching the API.
export const onRequestError = Sentry.captureRequestError;
