"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { IntroText } from "../intro-text";
import { SyncActivityProvider } from "./sync-activity";
import { SettingsHeader } from "./settings-header";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export const SETTINGS_HASH = "#settings";

// Broadcast the dialog's open state to sibling dashboard surfaces that live
// outside it - specifically the save-playlist tip, which portals to the body
// like this dialog does and must stand down while it's up, or it paints over
// the dialog (issue #243, most visible after a refresh at #settings where
// both restore at once). A module store rather than context: the tip and the
// dialog sit in separate subtrees under the page, and the close path uses
// replaceState (no hashchange), so the dialog's own state is the only signal
// that tracks both open and close.
let settingsOpen = false;
const settingsOpenListeners = new Set<() => void>();

function setSettingsOpen(next: boolean) {
  if (next === settingsOpen) {
    return;
  }
  settingsOpen = next;
  for (const listener of settingsOpenListeners) {
    listener();
  }
}

export function useSettingsOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      settingsOpenListeners.add(onChange);
      return () => settingsOpenListeners.delete(onChange);
    },
    () => settingsOpen,
    () => false,
  );
}

// Opens and closes with the URL hash so settings are linkable (#settings)
// and the Back button dismisses the dialog. Triggers are plain anchors:
// native hash navigation fires hashchange, which Link's client-side
// navigation does not.
export function SettingsDialog({
  signature,
  lastSyncedAt,
  children,
}: {
  signature: string;
  lastSyncedAt: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The sync card (in the body) reports whether it is running or still
  // replaying steps, so the header can hold the warning's clear until that
  // simulated finish rather than the moment the workflow actually ends.
  const [syncActive, setSyncActive] = useState(false);

  useEffect(() => {
    const syncWithHash = () => setOpen(window.location.hash === SETTINGS_HASH);
    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    return () => window.removeEventListener("hashchange", syncWithHash);
  }, []);

  // Mirror the open state into the module store so the save-playlist tip can
  // stand down while settings is up. Cleared on unmount so a torn-down dialog
  // never leaves the flag stuck on.
  useEffect(() => {
    setSettingsOpen(open);
    return () => setSettingsOpen(false);
  }, [open]);

  // router.refresh() (see the sync card's poll-complete refresh and the
  // background-run watch below) reconciles the URL as part of applying the
  // refreshed tree, which drops the hash. Re-assert #settings whenever the
  // dialog is open but the hash has drifted out from under it, so a sync
  // finishing mid-settings doesn't silently boot the user back to the
  // dashboard. No dependency array: the drift can happen on any render.
  useEffect(() => {
    if (open && window.location.hash !== SETTINGS_HASH) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search + SETTINGS_HASH,
      );
    }
  });

  // The sync card refreshes the dashboard when a run it is polling
  // finishes, but it unmounts with the dialog. Cover a run that outlives
  // the dialog: on mount and after every close, poll a live run to its end
  // and refresh. Best-effort like the card itself - a failed status fetch
  // just stops the watch.
  useEffect(() => {
    if (open) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let sawRunning = false;
    async function poll() {
      let status: { status?: string } | null = null;
      try {
        const res = await fetch("/api/me/sync");
        status = res.ok ? await res.json() : null;
      } catch {
        status = null;
      }
      if (cancelled) {
        return;
      }
      if (status?.status === "running") {
        sawRunning = true;
        timer = setTimeout(poll, 3000);
      } else if (sawRunning) {
        router.refresh();
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, router]);

  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      return;
    }
    // replaceState fires no hashchange, so close the dialog directly.
    setOpen(false);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SettingsHeader
          signature={signature}
          lastSyncedAt={lastSyncedAt}
          syncActive={syncActive}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <IntroText className="mb-4 text-xs text-muted-foreground italic" />
          <SyncActivityProvider value={setSyncActive}>
            {children}
          </SyncActivityProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}
