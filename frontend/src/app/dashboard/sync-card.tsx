"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Check, ChevronDown, Circle, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { startSync } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";

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
  pending: "text-muted-foreground",
  running: "",
  completed: "text-green-600 dark:text-green-500",
  failed: "text-destructive",
};

async function fetchStatus(): Promise<SyncStatus | null> {
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

export function SyncCard({
  lastfmLinked,
  citySet,
}: {
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
  const [runSeq, setRunSeq] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [starting, startTransition] = useTransition();

  // Loaded client-side so the page never waits on Temporal to render.
  useEffect(() => {
    let cancelled = false;
    fetchStatus().then((next) => {
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
  }, []);

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
      const next = await fetchStatus();
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
  }, [polling, router]);

  const running = status?.status === "running";
  // Fraction of the run already done, for the button's progress ring: each
  // completed step is a full share, the in-flight step counts as half. The
  // floor keeps a just-started run from showing a dead, empty ring.
  const steps = status?.steps ?? [];
  const completedShare =
    steps.filter((step) => step.status === "completed").length +
    (steps.some((step) => step.status === "running") ? 0.5 : 0);
  const progress =
    steps.length > 0 ? Math.max(completedShare / steps.length, 0.04) : null;
  // The button shows a spinner while checking for an existing run, while one is
  // in progress, and while the step playback is still catching up after the run
  // finished behind the scenes (settling).
  const busy = running || statusLoading || settling;
  const finishedAt = status?.finished_at
    ? syncedAtFormat.format(new Date(status.finished_at))
    : null;
  const finalOutcome = status?.status ?? "none";
  // A live run (or its settle animation) always wins the status area, even if a
  // requirement looks unmet - never replace an active run with the setup hint.
  const showSteps = (running || settling) && status !== null;

  // Client-side gate only (no backend change yet): a sync needs both a linked
  // Last.fm account and a city, both set from sections below.
  const missing = [
    !lastfmLinked && "link Last.fm account",
    !citySet && "set home city",
  ].filter((item): item is string => item !== false);
  const canSync = missing.length === 0;
  const missingNote = canSync
    ? null
    : `${missing.join(" and ")} below to enable sync.`.replace(/^./, (c) =>
        c.toUpperCase(),
      );

  function onSync() {
    if (!canSync) {
      return;
    }
    // Show the run as started right away; the first poll replaces this with
    // real state, and a failed start reverts it.
    const previous = status;
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
      const result = await startSync();
      if (result.error) {
        setStatus(previous);
        toast.error(result.error);
        return;
      }
      setPolling(true);
    });
  }

  return (
    // While a run plays back, the step display replaces the trigger row, so
    // the panel closes for the duration and reopens after. Driving `open`
    // (instead of unmounting the content) lets both moves animate: Radix
    // skips the animation when content mounts already open.
    <Collapsible open={expanded && !showSteps} onOpenChange={setExpanded}>
      {/* The status column reserves the two-line height of a step display
          (min-h-9) and everything centers within the row, so the button holds
          its place across states and stays centered next to the last-run line
          even when that line wraps. The expanded step list renders below the
          row (not inside the status column) so opening it never re-centers
          the button. */}
      <div className="flex items-center gap-3">
        <span
          className="order-last shrink-0"
          title={missingNote ?? undefined}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onSync}
            disabled={starting || busy || !canSync}
            aria-label="Sync"
            title={canSync ? "Sync" : undefined}
            className="relative text-muted-foreground"
          >
            {/* Kept in the layout (just hidden) while busy so the button
                holds its size under the spinner. */}
            <RefreshCw aria-hidden className={busy ? "invisible" : undefined} />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center">
                {(running || settling) && progress !== null ? (
                  <SyncProgressRing fraction={settling ? 1 : progress} />
                ) : (
                  <Spinner />
                )}
              </span>
            )}
          </Button>
        </span>
        <div className="flex min-h-9 min-w-0 flex-1 items-center">
          {showSteps && status ? (
            <div className="min-w-0 flex-1 animate-fade-in">
              <CurrentStep
                key={runSeq}
                steps={status.steps}
                finished={!running}
                onSettled={() => setSettling(false)}
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              {status && finalOutcome !== "none" && (
                <CollapsibleTrigger
                  className={`group -mx-1.5 -my-0.5 flex animate-slide-in-up cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm hover:bg-muted dark:hover:bg-muted/50 ${
                    finalOutcome === "failed"
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={
                      finalOutcome === "failed"
                        ? "text-destructive"
                        : "text-green-600 dark:text-green-500"
                    }
                  >
                    <StepMark status={finalOutcome} />
                  </span>
                  {/* The mark rides beside the text, hugging it on one line
                      and centered on the right of both lines when it wraps -
                      never wrapping onto the second line itself. */}
                  <span className="min-w-0">
                    {finalOutcome === "failed"
                      ? "Last sync failed"
                      : "Last synced"}
                    {finishedAt && ` ${finishedAt}`}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
                  />
                </CollapsibleTrigger>
              )}
              {finalOutcome === "none" && !statusLoading && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onSync}
                  disabled={starting || !canSync}
                  // -ml-2.5 cancels the ghost padding so the label stays
                  // optically aligned with the card content edge; the height
                  // and whitespace overrides let the label wrap on narrow
                  // screens.
                  className="-ml-2.5 h-auto min-h-7 animate-fade-in justify-start text-left whitespace-normal text-muted-foreground"
                >
                  {canSync && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden
                    />
                  )}
                  Get started by running a manual sync.
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {status && finalOutcome !== "none" && (
        <CollapsibleContent>
          <div className="pt-2">
            <StepList steps={status.steps} />
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

// Determinate progress ring for the sync button: the arc fills clockwise
// from the top as steps complete.
function SyncProgressRing({ fraction }: { fraction: number }) {
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 -rotate-90"
      role="status"
      aria-label={`Sync progress: ${Math.round(fraction * 100)}%`}
    >
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="1.5"
        className="stroke-border"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        className="stroke-current transition-[stroke-dashoffset] duration-500"
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

function StepList({ steps }: { steps: SyncStep[] }) {
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

function StepMark({ status }: { status: SyncStep["status"] }) {
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
