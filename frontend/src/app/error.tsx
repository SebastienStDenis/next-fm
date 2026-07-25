"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { Haze } from "@/components/haze";
import { Button } from "@/components/ui/button";

// Route-level boundary for everything outside the dashboard (which has its
// own): a failed page renders inside the root layout instead of falling
// through to the bare global-error document.
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // The boundary catches the error before any global handler sees it, so
  // this capture is the only thing that tells Sentry.
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Haze>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Something went wrong
        </h1>
      </Haze>
      <Haze>
        <p className="max-w-md text-center text-muted-foreground">
          NextFM ran into an unexpected problem loading this page.
        </p>
      </Haze>
      <Haze>
        <Button size="lg" onClick={() => unstable_retry()}>
          Try again
        </Button>
      </Haze>
    </main>
  );
}
