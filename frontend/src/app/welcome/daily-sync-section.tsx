"use client";

import { type ReactNode } from "react";

import { Section } from "../dashboard/section";
import { useSyncSettled } from "../dashboard/sync-activity";

// The Daily Sync section, with its state mark computed on the client so the
// green check waits for the sync card's simulated steps to finish. `reached`
// is true once the user is on (or past) the sync step; until playback settles
// the mark holds its pulsing dot, then crossfades to the check - landing with
// the completion footer instead of the moment the real sync lands on record.
export function DailySyncSection({
  synced,
  reached,
  children,
}: {
  synced: boolean;
  reached: boolean;
  children: ReactNode;
}) {
  const settled = useSyncSettled();
  const state = reached ? (synced && settled ? "done" : "active") : undefined;
  return (
    <Section
      heading="Daily Sync"
      state={state}
      description="Imports listening history, suggests artists, finds concerts and generates playlists."
    >
      {children}
    </Section>
  );
}
