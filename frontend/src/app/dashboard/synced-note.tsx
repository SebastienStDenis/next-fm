"use client";

import { useSyncExternalStore } from "react";
import { Check } from "lucide-react";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const emptySubscribe = () => () => {};

// Freshness marker for a tab fed by a sync step: a green check and the time
// the step last succeeded (see docs/wording.md). Formats in the viewer's
// timezone, which the server can't know - renders only after hydration so
// server and client HTML always match.
export function SyncedNote({ label, iso }: { label: string; iso: string }) {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  if (!hydrated) {
    return null;
  }
  return (
    <span className="flex animate-fade-in items-center gap-1.5 text-xs font-normal text-muted-foreground">
      <Check
        className="size-3.5 text-green-600 dark:text-green-500"
        strokeWidth={2.5}
        aria-hidden
      />
      {label} · {dateFormat.format(new Date(iso))}
    </span>
  );
}
