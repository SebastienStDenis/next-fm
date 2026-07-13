"use client";

import { useCallback, useState, type ReactNode } from "react";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { SyncActivityProvider } from "../dashboard/sync-activity";
import { Button } from "@/components/ui/button";

// Wraps the setup sections and the completion footer so the two can
// coordinate: the footer only reveals once the setup is done and on record
// (`ready`) and the sync card has finished replaying its steps (`!active`).
export function WelcomeFlow({
  ready,
  children,
}: {
  ready: boolean;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);
  const report = useCallback((next: boolean) => setActive(next), []);

  // Once the first sync's steps have played out, the footer stays put: a
  // manual re-run (or one that fails, leaving the earlier sync on record)
  // shouldn't collapse the "go to dashboard" prompt and replay its reveal.
  const [revealed, setRevealed] = useState(false);
  if (ready && !active && !revealed) {
    setRevealed(true);
  }

  return (
    <SyncActivityProvider value={report}>
      {children}
      {/* The grow-in wrapper opens up the footer's room gradually; without
          it the centered page re-centers in one frame and visibly jumps.
          Held back until the sync card has finished replaying each step, so
          the "go to dashboard" prompt lands after the run reads as done. */}
      {ready && (revealed || !active) && (
        <div className="grid animate-grow-in grid-rows-[1fr]">
          <div className="min-h-0 overflow-hidden">
            <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 animate-fade-in-delayed">
              <p className="text-sm">All set. Playlists update daily.</p>
              <Button asChild size="sm">
                <Link href="/dashboard">
                  Go to dashboard
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </SyncActivityProvider>
  );
}
