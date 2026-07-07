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
  steps: SyncStep[];
};

const POLL_INTERVAL_MS = 1500;

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

export function SyncCard({
  userId,
  lastfmLinked,
  initialStatus,
}: {
  userId: string;
  lastfmLinked: boolean;
  initialStatus: SyncStatus | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [polling, setPolling] = useState(initialStatus?.status === "running");
  const [error, setError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  useEffect(() => {
    if (!polling) {
      return;
    }
    let cancelled = false;
    async function tick() {
      let next: SyncStatus;
      try {
        const res = await fetch(`/api/users/${userId}/sync`);
        if (!res.ok) {
          return;
        }
        next = await res.json();
      } catch {
        // Transient poll failures just skip a tick.
        return;
      }
      if (cancelled) {
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

  function onSync() {
    startTransition(async () => {
      const result = await startSync(userId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
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
      {status && status.status !== "none" && (
        <ul className="space-y-1">
          {status.steps.map((step) => (
            <li
              key={step.key}
              className="flex flex-wrap items-baseline gap-2 text-sm"
            >
              <span className={stepMarkClasses[step.status]}>
                {stepMarks[step.status]}
              </span>
              <span
                className={
                  step.status === "pending" ? "text-gray-500" : undefined
                }
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
      )}
      {status?.status === "failed" && (
        <p className="text-sm text-red-600">
          The last sync failed. Syncing again picks up where it left off.
        </p>
      )}
    </div>
  );
}
