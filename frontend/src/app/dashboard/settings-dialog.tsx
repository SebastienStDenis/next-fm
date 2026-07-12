"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { IntroText } from "../intro-text";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const SETTINGS_HASH = "#settings";

// Opens and closes with the URL hash so settings are linkable (#settings)
// and the Back button dismisses the dialog. Triggers are plain anchors:
// native hash navigation fires hashchange, which Link's client-side
// navigation does not.
export function SettingsDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncWithHash = () => setOpen(window.location.hash === SETTINGS_HASH);
    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    return () => window.removeEventListener("hashchange", syncWithHash);
  }, []);

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
        className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Settings</DialogTitle>
          <IntroText className="text-xs text-muted-foreground italic" />
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
