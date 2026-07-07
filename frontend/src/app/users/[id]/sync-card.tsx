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
  citySet,
}: {
  userId: string;
  lastfmLinked: boolean;
  citySet: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  // True until the first status fetch resolves: we don't yet know whether a
  // run is already in progress, so the button shows a spinner meanwhile.
  const [statusLoading, setStatusLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [settling, setSettling] = useState(false);
  // Briefly true after the run settles: the final step slides up and out while
  // the last-synced line slides in.
  const [leaving, setLeaving] = useState(false);
  const [runSeq, setRunSeq] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  // Loaded client-side so the page never waits on Temporal to render.
  useEffect(() => {
    let cancelled = false;
    fetchStatus(userId).then((next) => {
      if (cancelled) {
        return;
      }
      if (next !== null) {
        // A Sync click may have set optimistic state before this resolved;
        // never clobber it with the pre-click snapshot.
        setStatus((prev) => prev ?? next);
        if (next.status === "running") {
          setPolling(true);
        }
      }
      setStatusLoading(false);
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

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = setTimeout(() => setLeaving(false), 250);
    return () => clearTimeout(timer);
  }, [leaving]);

  const running = status?.status === "running";
  // The button shows a spinner while checking for an existing run, while one is
  // in progress, and while the step playback is still catching up after the run
  // finished behind the scenes (settling).
  const busy = running || statusLoading || settling;
  const finishedAt = status?.finished_at
    ? syncedAtFormat.format(new Date(status.finished_at))
    : null;

  // Client-side gate only (no backend change yet): a sync needs both a linked
  // Last.fm account and a city, both set from sections below.
  const missing = [
    !lastfmLinked && "link a Last.fm account",
    !citySet && "set a city",
  ].filter((item): item is string => item !== false);
  const canSync = missing.length === 0;
  const missingNote = canSync
    ? null
    : `${missing.join(" and ")} below to sync.`.replace(/^./, (c) =>
        c.toUpperCase(),
      );

  function onSync() {
    if (!canSync) {
      return;
    }
    // Show the run as started right away; the first poll replaces this with
    // real state, and a failed start reverts it.
    const previous = status;
    setError(null);
    // A click during the settle window starts a fresh run; drop the old
    // playback (keyed by runSeq) instead of letting it resume mid-list.
    setSettling(false);
    setLeaving(false);
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
    <div>
      {/* The Sync button stays put; the running steps play out to its right,
          centered against the button while a run plays and pinned to the top
          once idle so expanding the step list only grows downward. */}
      <div className="flex min-h-9 flex-col justify-center">
        <div
          className={`flex gap-3 ${
            running || settling ? "items-center" : "items-start"
          }`}
        >
          <button
            type="button"
            onClick={onSync}
            disabled={starting || busy || !canSync}
            className="relative inline-flex shrink-0 items-center justify-center rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/* Kept in the layout (just hidden) while busy so the button holds
                the same width as when it reads "Sync". */}
            <span className={busy ? "invisible" : undefined}>Sync</span>
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            {(running || settling) && status ? (
              <div className="animate-fade-in">
                <CurrentStep
                  key={runSeq}
                  steps={status.steps}
                  finished={!running}
                  onSettled={() => {
                    setSettling(false);
                    setLeaving(true);
                  }}
                />
              </div>
            ) : (
              <div className="relative pt-1">
                {leaving && status && (
                  <div className="absolute inset-x-0 top-0 animate-slide-out-up">
                    <LastStepLine steps={status.steps} />
                  </div>
                )}
                {status && status.status !== "none" && (
                  <details className="animate-slide-in-up">
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
            )}
          </div>
        </div>
      </div>
      {missingNote && (
        <p className="mt-2 text-sm text-gray-500">{missingNote}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 animate-spin"
      fill="none"
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth={2}
        className="opacity-25"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
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

// The final step the playback showed - the furthest-progressed non-pending
// step (the last completed step, or the failed one). Rendered on its way out
// as the last-synced line slides in.
function LastStepLine({ steps }: { steps: SyncStep[] }) {
  let last = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].status !== "pending") {
      last = i;
    }
  }
  if (last === -1) {
    return null;
  }
  const step = steps[last];
  return (
    <StepLine
      snapshot={{
        key: String(last),
        label: step.label,
        status: step.status,
        summary: step.summary,
        position: last + 1,
      }}
      total={steps.length}
    />
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
      <span className={`mt-0.5 ${stepMarkClasses[snapshot.status]}`}>
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
        <p
          key={snapshot.status}
          className="animate-fade-in truncate text-xs text-gray-500"
        >
          {snapshot.summary ??
            (snapshot.status === "running" ? "In progress" : " ")}
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
