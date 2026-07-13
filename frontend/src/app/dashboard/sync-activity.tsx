"use client";

import { createContext, useContext } from "react";

// Lets a surrounding flow (the welcome page) learn when the sync card is
// actively showing or replaying steps, so it can hold back its own reveal
// until playback settles. Absent a provider (the dashboard), reporting is a
// no-op.
const SyncActivityContext = createContext<(active: boolean) => void>(() => {});

export const SyncActivityProvider = SyncActivityContext.Provider;

export function useReportSyncActivity() {
  return useContext(SyncActivityContext);
}

// Whether the welcome flow's sync playback has settled - the same signal that
// gates its completion footer. The Daily Sync section reads it to hold its
// green check back until the simulated steps finish, so the check and the
// footer land together. Defaults to settled (true) so a consumer without a
// provider just reflects the plain synced state.
const SyncSettledContext = createContext<boolean>(true);

export const SyncSettledProvider = SyncSettledContext.Provider;

export function useSyncSettled() {
  return useContext(SyncSettledContext);
}
