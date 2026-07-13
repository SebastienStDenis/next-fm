"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ChevronDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { startSync } from "./actions";
import { useReportSyncActivity } from "./sync-activity";
import {
  CurrentStep,
  fetchStatus,
  POLL_INTERVAL_MS,
  StepList,
  StepMark,
  syncDateFormat,
  type SyncStatus,
} from "./sync-steps";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";

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
  // Progress ring fraction, reported by the step playback so the ring tracks
  // the step on screen rather than the (often further-ahead) real workflow.
  const [progress, setProgress] = useState<number | null>(null);
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
  // The button shows a spinner while checking for an existing run, while one is
  // in progress, and while the step playback is still catching up after the run
  // finished behind the scenes (settling).
  const busy = running || statusLoading || settling;
  const finishedAt = status?.finished_at
    ? syncDateFormat.format(new Date(status.finished_at))
    : null;
  const finalOutcome = status?.status ?? "none";
  // A live run (or its settle animation) always wins the status area, even if a
  // requirement looks unmet - never replace an active run with the setup hint.
  const showSteps = (running || settling) && status !== null;

  // Tell a surrounding welcome flow (if any) while the step display is up, so
  // it can defer revealing its completion footer until playback settles.
  const reportActivity = useReportSyncActivity();
  useEffect(() => {
    reportActivity(showSteps);
    return () => reportActivity(false);
  }, [reportActivity, showSteps]);

  // A sync needs both a linked Last.fm account and a home city, each set
  // from its own section; the API refuses to start one without them too.
  const missing = [
    !lastfmLinked && "link Last.fm account",
    !citySet && "set home city",
  ].filter((item): item is string => item !== false);
  const canSync = missing.length === 0;
  const missingNote = canSync
    ? null
    : `${missing.join(" and ")} to enable sync.`.replace(/^./, (c) =>
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
    setProgress(null);
    setRunSeq((seq) => seq + 1);
    setStatus({
      status: "running",
      started_at: null,
      finished_at: null,
      steps: (previous?.steps ?? []).map((step) => ({
        ...step,
        status: "pending" as const,
        summary: null,
        finished_at: null,
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
                  <SyncProgressRing fraction={progress} />
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
                onProgress={setProgress}
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
                  variant="outline"
                  size="sm"
                  onClick={onSync}
                  disabled={starting || !canSync}
                  className="animate-fade-in"
                >
                  Run a manual sync
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


