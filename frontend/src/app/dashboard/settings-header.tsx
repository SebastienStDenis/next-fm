"use client";

import { useState } from "react";
import { Triangle, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogClose, DialogTitle } from "@/components/ui/dialog";

// The dialog's fixed header: the title and close stay put while the body
// scrolls. Rendered inside DialogContent, so it remounts each time the dialog
// opens - `baseline` snapshots the settings state at open, and any later
// divergence (a change that only a sync will apply) reveals the warning on the
// line below. Reverting a field back, or reopening the dialog, clears it.
//
// A completed sync applies the pending changes, so the current state becomes
// the new baseline and the warning clears. `lastSyncedAt` advances the moment
// the workflow finishes (the sync card refreshes the tree), but the card keeps
// replaying its steps for a beat after; `syncActive` stays true through that
// playback, so the clear is held until the simulated run reads as done.
//
// The warning stays mounted and collapses via grid-rows 0fr<->1fr with a
// matching opacity fade, so it loads and unloads smoothly (both height and
// text) instead of popping in and out.
export function SettingsHeader({
  signature,
  lastSyncedAt,
  syncActive,
}: {
  signature: string;
  lastSyncedAt: string | null;
  syncActive: boolean;
}) {
  const [baseline, setBaseline] = useState(signature);
  const [syncedAt, setSyncedAt] = useState(lastSyncedAt);
  const [syncPending, setSyncPending] = useState(false);
  if (lastSyncedAt !== syncedAt) {
    setSyncedAt(lastSyncedAt);
    setSyncPending(true);
  }
  if (syncPending && !syncActive) {
    setSyncPending(false);
    setBaseline(signature);
  }
  const changed = signature !== baseline;
  return (
    <div className="flex-none px-4 pt-4 pb-2">
      <div className="flex items-center gap-3">
        <DialogTitle className="text-lg">Settings</DialogTitle>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0 text-muted-foreground"
          >
            <XIcon aria-hidden />
            <span className="sr-only">Close</span>
          </Button>
        </DialogClose>
      </div>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-250 ease-out motion-reduce:transition-none ${
          changed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <p className="flex items-start gap-1.5 pt-2 text-xs text-foreground">
            <Triangle
              aria-hidden
              className="mt-px size-3.5 shrink-0 text-warning"
            />
            <span>
              Run a manual sync to apply updates now, or wait for the next daily
              sync.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
