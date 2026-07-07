"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
  completed: "text-gray-500",
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
        Link a Last.fm account in the Account section to sync.
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
    <div className="space-y-3">
      <button
        type="button"
        onClick={onSync}
        disabled={starting || running}
        className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
      >
        {running ? "Syncing..." : "Sync"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {(running || settling) && status && (
        <CurrentStep
          steps={status.steps}
          finished={!running}
          onSettled={() => setSettling(false)}
        />
      )}
      {!running && !settling && status && status.status !== "none" && (
        <details>
          <summary
            className={`cursor-pointer text-sm ${
              status.status === "failed" ? "text-red-600" : "text-gray-500"
            }`}
          >
            {status.status === "failed" ? "Last sync failed" : "Last synced"}
            {finishedAt && ` ${finishedAt}`}.
          </summary>
          <div className="mt-2">
            <StepList steps={status.steps} />
          </div>
        </details>
      )}
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
  // snapshot, a cursor plays the step list back at a readable pace: every
  // step shows as running for a beat, then holds its final state, before the
  // display advances. Playback may lag reality by a step or two.
  const [cursor, setCursor] = useState<{
    index: number;
    phase: "running" | "final";
  }>(() => {
    const active = steps.findIndex((step) => step.status !== "completed");
    return {
      index: active === -1 ? steps.length - 1 : active,
      phase: "running",
    };
  });

  // Steps can arrive after mount (the optimistic click state has none), so
  // clamp rather than trust the index.
  const index = Math.min(Math.max(cursor.index, 0), steps.length - 1);
  const step = index >= 0 ? steps[index] : undefined;

  useEffect(() => {
    if (!step) {
      if (finished) {
        onSettled();
      }
      return;
    }
    const done = step.status === "completed" || step.status === "failed";
    if (cursor.phase === "running") {
      if (!done) {
        return;
      }
      const timer = setTimeout(
        () => setCursor({ index, phase: "final" }),
        STEP_HOLD_MS,
      );
      return () => clearTimeout(timer);
    }
    const next = steps[index + 1];
    if (next && next.status !== "pending") {
      const timer = setTimeout(
        () => setCursor({ index: index + 1, phase: "running" }),
        STEP_HOLD_MS,
      );
      return () => clearTimeout(timer);
    }
    if (finished) {
      const timer = setTimeout(onSettled, STEP_HOLD_MS);
      return () => clearTimeout(timer);
    }
  }, [steps, cursor.phase, index, step, finished, onSettled]);

  if (!step) {
    return null;
  }
  const shownStatus = cursor.phase === "final" ? step.status : "running";

  return (
    <div className="flex gap-2 text-sm">
      <span className={`mt-0.5 ${stepMarkClasses[shownStatus]}`}>
        <StepMark status={shownStatus} />
      </span>
      <div>
        <span>{step.label}</span>
        {shownStatus === "failed" && (
          <span className="ml-2 text-xs text-red-600">failed</span>
        )}
        <span className="ml-2 text-xs text-gray-400 dark:text-gray-600">
          step {index + 1} of {steps.length}
        </span>
        {cursor.phase === "final" && step.summary && (
          <p className="text-xs text-gray-500">{step.summary}</p>
        )}
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
