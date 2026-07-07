"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { startSync } from "./actions";

export type SyncStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  summary: string | null;
};

export type SyncStatus = {
  status: "none" | "running" | "completed" | "failed";
  started_at: string | null;
  finished_at: string | null;
  steps: SyncStep[];
};

const POLL_INTERVAL_MS = 1500;
// How long a finished step keeps showing its final state before the display
// moves on.
const STEP_HOLD_MS = 900;

const syncedAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const stepMarkClasses: Record<SyncStep["status"], string> = {
  pending: "text-gray-400 dark:text-gray-600",
  running: "animate-pulse",
  completed: "text-green-600 dark:text-green-500",
  failed: "text-red-600",
};

async function fetchStatus(userId: string): Promise<SyncStatus | null> {
  try {
    const res = await fetch(`/api/users/${userId}/sync`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  } catch {
    return null;
  }
}

export function SyncCard({
  userId,
  lastfmLinked,
}: {
  userId: string;
  lastfmLinked: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [settling, setSettling] = useState(false);
  const [runSeq, setRunSeq] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  // Loaded client-side so the page never waits on Temporal to render.
  useEffect(() => {
    let cancelled = false;
    fetchStatus(userId).then((next) => {
      if (cancelled || next === null) {
        return;
      }
      // A Sync click may have set optimistic state before this resolved;
      // never clobber it with the pre-click snapshot.
      setStatus((prev) => prev ?? next);
      if (next.status === "running") {
        setPolling(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!polling) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    async function tick() {
      // The status call can be slow under load; never let ticks stack up.
      if (inFlight) {
        return;
      }
      inFlight = true;
      const next = await fetchStatus(userId);
      inFlight = false;
      if (cancelled || next === null) {
        return;
      }
      setStatus(next);
      if (next.status !== "running") {
        setPolling(false);
        // Let the last step's final state show before collapsing to the
        // last-synced line.
        setSettling(true);
        router.refresh();
      }
    }
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling, userId, router]);

  if (!lastfmLinked) {
    return (
      <p className="text-sm text-gray-500">
        Link a Last.fm account above to sync.
      </p>
    );
  }

  const running = status?.status === "running";
  const finishedAt = status?.finished_at
    ? syncedAtFormat.format(new Date(status.finished_at))
    : null;

  function onSync() {
    // Show the run as started right away; the first poll replaces this with
    // real state, and a failed start reverts it.
    const previous = status;
    setError(null);
    // A click during the settle window starts a fresh run; drop the old
    // playback (keyed by runSeq) instead of letting it resume mid-list.
    setSettling(false);
    setRunSeq((seq) => seq + 1);
    setStatus({
      status: "running",
      started_at: null,
      finished_at: null,
      steps: (previous?.steps ?? []).map((step) => ({
        ...step,
        status: "pending" as const,
        summary: null,
      })),
    });
    startTransition(async () => {
      const result = await startSync(userId);
      if (result.error) {
        setStatus(previous);
        setError(result.error);
        return;
      }
      setPolling(true);
    });
  }

  return (
    <div className="rounded border border-gray-300 p-4 dark:border-gray-700">
      {/* Fixed-height area holding either the sync control or the running
          steps, vertically centered, so swapping them never shifts the
          layout below; expanding the step list is the one user-initiated
          exception. */}
      <div className="flex min-h-9 flex-col justify-center">
        {(running || settling) && status ? (
          <div className="animate-fade-in">
            <CurrentStep
              key={runSeq}
              steps={status.steps}
              finished={!running}
              onSettled={() => setSettling(false)}
            />
          </div>
        ) : (
          <div className="animate-fade-in">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={onSync}
                disabled={starting}
                className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
              >
                Sync
              </button>
              {status && status.status !== "none" && (
                <details className="min-w-0 flex-1 pt-1">
                  <summary
                    className={`cursor-pointer text-sm ${
                      status.status === "failed"
                        ? "text-red-600"
                        : "text-gray-500"
                    }`}
                  >
                    {status.status === "failed"
                      ? "Last sync failed"
                      : "Last synced"}
                    {finishedAt && ` ${finishedAt}`}.
                  </summary>
                  <div className="mt-2">
                    <StepList steps={status.steps} />
                  </div>
                </details>
              )}
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function CurrentStep({
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
    <div className="flex gap-2 text-sm">
      {/* Keyed by status so a phase flip remounts and fades the icon. */}
      <span
        key={snapshot.status}
        className={`mt-0.5 animate-fade-in ${stepMarkClasses[snapshot.status]}`}
      >
        <StepMark status={snapshot.status} />
      </span>
      <div className="min-w-0">
        <span>{snapshot.label}</span>
        {snapshot.status === "failed" && (
          <span className="ml-2 animate-fade-in text-xs text-red-600">
            failed
          </span>
        )}
        <span className="ml-2 text-xs text-gray-400 dark:text-gray-600">
          step {snapshot.position} of {total}
        </span>
        {/* One truncated line so the fixed-height status area never
            overflows; the post-run step list shows the full text. A running
            step has no summary yet, so a placeholder keeps the two-line
            height (and vertical centering) consistent. */}
        <p className="animate-fade-in truncate text-xs text-gray-500">
          {snapshot.summary ??
            (snapshot.status === "running" ? "Running..." : " ")}
        </p>
      </div>
    </div>
  );
}

function StepList({ steps }: { steps: SyncStep[] }) {
  return (
    <ul className="space-y-1.5">
      {steps.map((step) => (
        <li key={step.key} className="flex gap-2 text-sm">
          <span className={`mt-0.5 ${stepMarkClasses[step.status]}`}>
            <StepMark status={step.status} />
          </span>
          <div>
            <span
              className={
                step.status === "pending" ? "text-gray-500" : undefined
              }
            >
              {step.label}
            </span>
            {step.status === "failed" && (
              <span className="ml-2 text-xs text-red-600">failed</span>
            )}
            {step.summary && (
              <p className="text-xs text-gray-500">{step.summary}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StepMark({ status }: { status: SyncStep["status"] }) {
  if (status === "completed") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden
      >
        <path d="m4.5 4.5 7 7m0-7-7 7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="4.5"
        fill={status === "running" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </svg>
  );
}
