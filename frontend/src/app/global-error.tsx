"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import "./globals.css";

/**
 * Replaces the root layout when the layout itself fails, so it renders its own
 * document and deliberately imports nothing from the app - whatever broke the
 * layout must not be able to break this page too.
 *
 * Next.js catches the error before it reaches any global handler, so this
 * `captureException` is the only thing that tells Sentry a root-layout failure
 * happened.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full min-w-80 flex items-center justify-center bg-background p-6 text-foreground">
        <main className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            NextFM ran into an unexpected problem loading this page.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
