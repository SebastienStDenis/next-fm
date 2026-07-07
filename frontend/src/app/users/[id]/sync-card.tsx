"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { startSync } from "./actions";

export type SyncStep = {
  key: "artists" | "suggestions" | "events" | "playlists";
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

const syncedAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const stepMarks: Record<SyncStep["status"], string> = {
  pending: "○",
  running: "●",
  completed: "✓",
  failed: "✕",
};

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
      <p className="text-sm text-gray-500">Link a Last.fm account to sync.</p>
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSync}
          disabled={starting || running}
          className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
        >
          {running ? "Syncing..." : "Sync everything"}
        </button>
        <span className="text-sm text-gray-500">
          {running
            ? "Runs in the background - leaving this page won't stop it."
            : "Artists, suggestions, concerts and playlists, in one go."}
        </span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {running && status && <StepList steps={status.steps} />}
      {!running && status && status.status !== "none" && (
        <div className="space-y-2">
          {status.status === "failed" ? (
            <p className="text-sm text-red-600">
              Last sync failed{finishedAt && ` ${finishedAt}`}. Syncing again
              picks up where it left off.
            </p>
          ) : (
            <p className="text-sm text-gray-500">
              Last synced{finishedAt && ` ${finishedAt}`}.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-gray-500">
              Steps
            </summary>
            <div className="mt-2">
              <StepList steps={status.steps} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function StepList({ steps }: { steps: SyncStep[] }) {
  return (
    <ul className="space-y-1">
      {steps.map((step) => (
        <li
          key={step.key}
          className="flex flex-wrap items-baseline gap-2 text-sm"
        >
          <span className={stepMarkClasses[step.status]}>
            {stepMarks[step.status]}
          </span>
          <span
            className={step.status === "pending" ? "text-gray-500" : undefined}
          >
            {step.label}
          </span>
          {step.status === "failed" && (
            <span className="text-xs text-red-600">failed</span>
          )}
          {step.summary && (
            <span className="text-xs text-gray-500">{step.summary}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
