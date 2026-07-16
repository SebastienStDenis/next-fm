"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  SyncActivityProvider,
  SyncSettledProvider,
} from "../dashboard/sync-activity";
import { cueSavePlaylistTip } from "../dashboard/save-playlist-tip";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";

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

  // Playback has settled once the reveal latch is set or the sync card is no
  // longer replaying steps. Gates both the footer and the Daily Sync section's
  // green check, so the two appear together once the simulation reads as done.
  const settled = revealed || !active;
  const showFooter = ready && settled;

  // On a phone the setup can already fill the screen, so the footer lands
  // below the fold with no cue to scroll (#244). Once it has finished opening
  // (a touch past the 250ms reveal), scroll the page down to bring the button
  // into view; when nothing overflows this is a no-op.
  useEffect(() => {
    if (!showFooter) return;
    const timer = setTimeout(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: "smooth",
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [showFooter]);

  return (
    <SyncActivityProvider value={report}>
      <SyncSettledProvider value={settled}>
        {children}
        {/* The footer opens as a collapsible so its height animates to a
            measured pixel value: the centered page re-centers gradually
            instead of jumping a frame (#262), and unlike a 1fr grid-row grow
            the measurement holds when the setup already overflows the
            viewport, keeping the button reachable on phones (#244). Held back
            until the sync card has finished replaying each step, so the "go
            to dashboard" prompt lands after the run reads as done. */}
        <Collapsible open={showFooter}>
          <CollapsibleContent>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-6">
              <p className="text-sm">All set. Playlists update daily.</p>
              <Button asChild size="sm">
                {/* Lands on the Playlists tab and drops a session cue for the
                    one-shot save-to-library tip on the leading playlist. */}
                <Link
                  href="/dashboard?tab=playlists"
                  onClick={cueSavePlaylistTip}
                >
                  Go to dashboard
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </SyncSettledProvider>
    </SyncActivityProvider>
  );
}
