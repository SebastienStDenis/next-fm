"use client";

import { Check } from "lucide-react";

import { AttentionDot } from "./attention-dot";
import { cn } from "@/lib/utils";

// The welcome flow's per-step mark: a pulsing "action" dot on the step to do
// now, a green check once it's done. Both live in one fixed-size slot and
// trade opacity, so completing a step crossfades the dot into the check with
// no pop and no sideways nudge of the heading. Client-side (like
// AnimatedHeight) on purpose: the swap has to run as an in-place React update
// for the opacity transition to fire - applied straight through a server
// re-render it commits in one shot and snaps. The slot fades in the first
// time it appears.
export function StepStatusMark({ state }: { state?: "active" | "done" }) {
  if (!state) {
    return null;
  }
  return (
    <span className="relative flex size-3.5 shrink-0 animate-fade-in">
      <span
        aria-hidden={state !== "active"}
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity duration-250 ease-out motion-reduce:transition-none",
          state === "active" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <AttentionDot pulse={state === "active"} />
      </span>
      <Check
        aria-hidden
        strokeWidth={2.5}
        className={cn(
          "absolute inset-0 size-3.5 text-green-600 transition-opacity duration-250 ease-out motion-reduce:transition-none dark:text-green-500",
          state === "done" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
    </span>
  );
}
