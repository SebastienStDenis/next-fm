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
