"use client";

import { useEffect, useMemo, useState } from "react";

import { Check, Circle, X } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

export type SyncStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  summary: string | null;
  // When the step reached its terminal state; null for steps that never ran.
  finished_at: string | null;
};

export type SyncStatus = {
  status: "none" | "running" | "completed" | "failed";
  started_at: string | null;
  finished_at: string | null;
  steps: SyncStep[];
};

export const POLL_INTERVAL_MS = 1500;
// How long a finished step keeps showing its final state before the display
// moves on.
const STEP_HOLD_MS = 900;

export const stepMarkClasses: Record<SyncStep["status"], string> = {
  pending: "text-muted-foreground",
  running: "",
  completed: "text-green-600 dark:text-green-500",
  failed: "text-destructive",
};

export const syncDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export async function fetchStatus(): Promise<SyncStatus | null> {
  try {
    const res = await fetch(`/api/me/sync`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  } catch {
    return null;
  }
}

export function StepList({ steps }: { steps: SyncStep[] }) {
  return (
    <ul className="space-y-1.5">
      {steps.map((step) => (
        <li
          key={step.key}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 text-sm"
        >
          <span className={stepMarkClasses[step.status]}>
            <StepMark status={step.status} />
          </span>
          <div className="min-w-0">
            <span
              className={
                step.status === "pending" ? "text-muted-foreground" : undefined
              }
            >
              {step.label}
            </span>
            {step.status === "failed" && (
              <span className="ml-2 text-xs text-destructive">failed</span>
            )}
          </div>
          {step.summary && (
            <p className="col-start-2 text-xs text-muted-foreground">
              {step.summary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function StepMark({ status }: { status: SyncStep["status"] }) {
  if (status === "completed") {
    return <Check aria-hidden className="size-3.5" strokeWidth={2.5} />;
  }
  if (status === "failed") {
    return <X aria-hidden className="size-3.5" strokeWidth={2.5} />;
  }
  if (status === "running") {
    return <Spinner className="size-3.5" />;
  }
  return <Circle aria-hidden className="size-3.5" />;
}

export function CurrentStep({
  steps,
  finished,
  onSettled,
}: {
  steps: SyncStep[];
  finished: boolean;
  onSettled: () => void;
}) {
  // Polling only snapshots the workflow, so a fast step can finish between
  // polls without ever being seen running. Instead of mirroring the latest
  // snapshot, a cursor plays the step list back: a step still running shows
  // live, and every finished state holds for a beat before the display
  // advances. Playback may lag reality by a step or two.
  const [cursor, setCursor] = useState<{
    index: number;
    phase: "running" | "final";
    since: number;
  }>(() => {
    const active = steps.findIndex((step) => step.status !== "completed");
    const index = active === -1 ? steps.length - 1 : active;
    const status = steps[index]?.status;
    return {
      index,
      phase:
        status === "completed" || status === "failed" ? "final" : "running",
      since: Date.now(),
    };
  });

  // The previously displayed state, kept mounted briefly so it can animate
  // out upward while the new state slides in from below.
  const [leaving, setLeaving] = useState<StepSnapshot | null>(null);

  // Steps can arrive after mount (the optimistic click state has none), so
  // clamp rather than trust the index.
  const index = Math.min(Math.max(cursor.index, 0), steps.length - 1);
  const step = index >= 0 ? steps[index] : undefined;
  const snapshot = useMemo<StepSnapshot | null>(
    () =>
      step
        ? {
            key: String(index),
            label: step.label,
            status: cursor.phase === "final" ? step.status : "running",
            summary: cursor.phase === "final" ? step.summary : null,
            position: index + 1,
          }
        : null,
    [step, index, cursor.phase],
  );

  useEffect(() => {
    if (!step || !snapshot) {
      if (finished) {
        onSettled();
      }
      return;
    }
    // Whatever is on screen stays there for at least STEP_HOLD_MS, measured
    // from when it appeared so poll updates don't restart the clock.
    const holdLeft = Math.max(0, STEP_HOLD_MS - (Date.now() - cursor.since));
    const done = step.status === "completed" || step.status === "failed";
    if (cursor.phase === "running") {
      if (!done) {
        return;
      }
      // A phase flip stays on the same line - no slide, the icon and
      // subtitle fade in place.
      const timer = setTimeout(
        () => setCursor({ index, phase: "final", since: Date.now() }),
        holdLeft,
      );
      return () => clearTimeout(timer);
    }
    const next = steps[index + 1];
    if (next && next.status !== "pending") {
      const nextDone =
        next.status === "completed" || next.status === "failed";
      const timer = setTimeout(() => {
        setLeaving(snapshot);
        setCursor({
          index: index + 1,
          phase: nextDone ? "final" : "running",
          since: Date.now(),
        });
      }, holdLeft);
      return () => clearTimeout(timer);
    }
    if (finished) {
      const timer = setTimeout(onSettled, holdLeft);
      return () => clearTimeout(timer);
    }
  }, [steps, cursor, index, step, snapshot, finished, onSettled]);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = setTimeout(() => setLeaving(null), 250);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!snapshot) {
    return null;
  }

  return (
    <div className="relative">
      {leaving && (
        <div className="absolute inset-x-0 top-0 animate-slide-out-up">
          <StepLine snapshot={leaving} total={steps.length} />
        </div>
      )}
      <div key={snapshot.key} className="animate-slide-in-up">
        <StepLine snapshot={snapshot} total={steps.length} />
      </div>
    </div>
  );
}

type StepSnapshot = {
  key: string;
  label: string;
  status: SyncStep["status"];
  summary: string | null;
  position: number;
};

function StepLine({
  snapshot,
  total,
}: {
  snapshot: StepSnapshot;
  total: number;
}) {
  return (
    // Two grid rows so the mark centers on the label line (or lines, when
    // the label wraps) without the subtitle row pulling it down.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 text-sm">
      <span className={stepMarkClasses[snapshot.status]}>
        <StepMark status={snapshot.status} />
      </span>
      <div className="min-w-0">
        <span>{snapshot.label}</span>
        {snapshot.status === "failed" && (
          <span className="ml-2 animate-fade-in text-xs text-destructive">
            failed
          </span>
        )}
        <span className="ml-2 text-xs text-muted-foreground">
          step {snapshot.position} of {total}
        </span>
      </div>
      {/* One truncated line so the fixed-height status area never
          overflows; the post-run step list shows the full text. A running
          step has no summary yet, so a placeholder keeps the two-line
          height (and vertical centering) consistent. */}
      <p
        key={snapshot.status}
        className="col-start-2 animate-fade-in truncate text-xs text-muted-foreground"
      >
        {snapshot.summary ??
          (snapshot.status === "running" ? "In progress" : " ")}
      </p>
    </div>
  );
}
