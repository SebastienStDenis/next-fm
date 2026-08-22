"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ChevronDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Collapse } from "./collapse";
import { startSync } from "@/lib/actions";
import { syncDateFormat } from "@/lib/formats";
import { useReportSyncActivity } from "./sync-activity";
import {
  CurrentStep,
  fetchStatus,
  POLL_INTERVAL_MS,
  RING_MIN_FRACTION,
  StepList,
  StepMark,
} from "./sync-steps";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { GHOST_PILL_CLASS } from "./ghost-pill";
import type { SyncStatus } from "@/lib/api-types";
import { cn } from "@/lib/utils";

// How long a run may be in flight before the card reassures the user that
// closing the page doesn't stop it.
const LONG_RUN_NOTICE_MS = 90_000;
const LONG_RUN_NOTICE =
  "Taking longer than usual. Feel free to close the page, the sync will continue.";
// Consecutive failed status polls before the card admits progress is
// unreachable instead of claiming the sync is still running.
const DEGRADED_POLL_FAILURES = 10;

// The poll's variant of fetchStatus (sync-steps.tsx): it surfaces the
// response's raw JSON text so ticks can recognize an unchanged payload by
// text alone, without deep-comparing parsed objects.
async function fetchRawStatus(): Promise<{
  raw: string;
  status: SyncStatus;
} | null> {
  try {
    const res = await fetch(`/api/me/sync`);
    if (!res.ok) {
      return null;
    }
    const raw = await res.text();
    const status: SyncStatus | null = JSON.parse(raw);
    return status === null ? null : { raw, status };
  } catch {
    return null;
  }
}

export function SyncCard({
  lastfmLinked,
  citySet,
  firstSync = false,
}: {
  lastfmLinked: boolean;
  citySet: boolean;
  firstSync?: boolean;
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
  // `active` drives the reveal; `last` keeps the outgoing text rendered while
  // the reveal collapses, so the line fades and shrinks away instead of
  // vanishing mid-animation.
  const [notice, setNotice] = useState<{
    active: "long-run" | "degraded" | null;
    last: "long-run" | "degraded";
  }>({ active: null, last: "long-run" });
  const [expanded, setExpanded] = useState(false);
  const [starting, startTransition] = useTransition();

  // Loaded client-side so the page never waits on the status call to render.
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
    let failures = 0;
    // Raw text of the last committed payload; scoped to this polling session
    // so the first tick of a run always commits over the optimistic seed.
    let lastRaw: string | null = null;
    const pollingSince = Date.now();
    async function tick() {
      // The status call can be slow under load; never let ticks stack up.
      if (inFlight) {
        return;
      }
      inFlight = true;
      const fetched = await fetchRawStatus();
      inFlight = false;
      if (cancelled) {
        return;
      }
      if (fetched === null) {
        // Progress is unreachable; only say so once it's clearly not a blip,
        // and never claim the sync is running when nothing confirms it.
        failures += 1;
        if (failures >= DEGRADED_POLL_FAILURES) {
          setNotice((prev) =>
            prev.active === "degraded" && prev.last === "degraded"
              ? prev
              : { active: "degraded", last: "degraded" },
          );
        }
        return;
      }
      failures = 0;
      const next = fetched.status;
      // An unchanged payload commits nothing: parsing yields a fresh object
      // every tick, which would re-render the card for no change.
      if (fetched.raw !== lastRaw) {
        lastRaw = fetched.raw;
        setStatus(next);
      }
      if (next.status !== "running") {
        setPolling(false);
        setNotice((prev) =>
          prev.active === null ? prev : { ...prev, active: null },
        );
        // Let the last step's final state show before collapsing to the
        // last-synced line.
        setSettling(true);
        return;
      }
      // A page opened mid-run re-attaches, so measure from the run's own
      // start when the server reports it, not from when polling began.
      const runningSince = next.started_at
        ? Date.parse(next.started_at)
        : pollingSince;
      const active =
        Date.now() - runningSince >= LONG_RUN_NOTICE_MS ? "long-run" : null;
      setNotice((prev) =>
        prev.active === active && prev.last === (active ?? prev.last)
          ? prev
          : { active, last: active ?? prev.last },
      );
    }
    tick();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!document.hidden) {
      timer = setInterval(tick, POLL_INTERVAL_MS);
    }
    // A hidden tab shows no progress, so the interval pauses with it; coming
    // back fetches immediately to catch up before the cadence resumes.
    const onVisibilityChange = () => {
      clearInterval(timer);
      if (!document.hidden) {
        tick();
        timer = setInterval(tick, POLL_INTERVAL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [polling]);

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
    // playback (keyed by runSeq) instead of letting it resume mid-list. Seed
    // the ring at its floor so the first frame paints a fresh ring rather than
    // flashing the spinner until the step playback reports back.
    setSettling(false);
    setNotice((prev) => ({ ...prev, active: null }));
    setProgress(RING_MIN_FRACTION);
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
      {firstSync && (
        <p className="pb-3 text-xs text-muted-foreground italic">
          {LONG_RUN_NOTICE}
        </p>
      )}
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
                onSettled={() => {
                  setSettling(false);
                  // Sync-gated UI across the site keys off the server-fetched
                  // status, so refresh only once playback settles - the page
                  // updates in step with what the display showed, not with
                  // the workflow running ahead of it.
                  router.refresh();
                }}
                onProgress={setProgress}
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              {status && finalOutcome !== "none" && (
                <CollapsibleTrigger
                  className={cn(
                    GHOST_PILL_CLASS,
                    "group animate-slide-in-up cursor-pointer gap-1.5 text-left text-sm",
                    finalOutcome === "failed"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <span
                    className={
                      finalOutcome === "failed"
                        ? "text-destructive"
                        : "text-success"
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
      {showSteps && (
        <Collapse
          show={
            notice.active === "degraded" ||
            (notice.active === "long-run" && !firstSync)
          }
        >
          <p
            className={cn(
              "pt-1 text-xs text-muted-foreground transition-opacity duration-250 motion-reduce:transition-none",
              notice.active ? "opacity-100" : "opacity-0",
            )}
          >
            {notice.last === "degraded"
              ? "Can't check sync progress right now. Retrying."
              : LONG_RUN_NOTICE}
          </p>
        </Collapse>
      )}
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
