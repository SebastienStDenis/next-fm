"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";

import "./globals.css";
import { fontVariables } from "./fonts";

/**
 * Replaces the root layout when the layout itself fails, so it renders its own
 * document and deliberately runs no app code - whatever broke the layout must
 * not be able to break this page too. The stylesheet and the font variables are
 * the exceptions: both are inert build output, and without them the fallback
 * would be a browser-default page that looks like it belongs to no product.
 * Both faces come along, because this title takes the display face - the
 * fallback pages are the exception docs/theme.md carves for them.
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
  const dark = usePreferredDark();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html
      lang="en"
      className={[
        "h-full antialiased font-sans",
        ...fontVariables,
        dark && "dark",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <body className="min-h-full min-w-80 flex items-center justify-center bg-background p-6 text-foreground">
        <main className="flex flex-col items-center gap-4 text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
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

// next-themes is part of the layout this page replaces, so the dark class has
// to be resolved here: the stored choice first, the browser's scheme when there
// is none. Reading `localStorage` directly ties this to next-themes' default
// storage key, which is the trade for not running the provider on a page whose
// whole job is to survive the app being broken. The server snapshot is light,
// as next-themes' own pre-hydration markup is.
function usePreferredDark() {
  return useSyncExternalStore(subscribeToScheme, readPreferredDark, () => false);
}

function subscribeToScheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readPreferredDark() {
  const stored = window.localStorage.getItem("theme");
  return (
    stored === "dark" ||
    (stored !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}
