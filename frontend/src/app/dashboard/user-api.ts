import { notFound } from "next/navigation";

import { apiFetch } from "@/lib/api";
import type { SyncStatus } from "./sync-card";

export type User = {
  id: string;
  name: string;
  include_known_artists: boolean;
  last_synced_at: string | null;
};

export async function loadMe(): Promise<User> {
  const res = await apiFetch("/me", { cache: "no-store" });
  if (res.status === 404 || res.status === 422) {
    notFound();
  }
  if (!res.ok) {
    throw new Error(`Failed to load user: ${res.status}`);
  }
  return res.json();
}

export async function fetchJson<T>(path: string, what: string): Promise<T> {
  const res = await apiFetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}

// The latest sync run, if any. Best-effort: any transport or Temporal error
// resolves to null so the page never breaks over status hints.
export async function loadSyncStatus(): Promise<SyncStatus | null> {
  try {
    const res = await apiFetch("/me/sync", { cache: "no-store" });
    if (!res.ok) {
      return null;
    }
    return res.json();
  } catch {
    return null;
  }
}

// True when the user has never completed a sync: the "get started" nudge.
// last_synced_at is the durable success record; a retained completed run also
// counts (it predates the column), and a running first sync isn't nudged.
// A null sync (transport or Temporal error) hides the nudge rather than
// breaking the page over a dot.
export function hasNeverSynced(user: User, sync: SyncStatus | null): boolean {
  return (
    user.last_synced_at === null &&
    (sync?.status === "none" || sync?.status === "failed")
  );
}

// Whether the latest sync run completed the given step. Empty lists read
// differently depending on it: "run a sync" vs "the sync found nothing".
export function syncStepCompleted(
  sync: SyncStatus | null,
  key: string,
): boolean {
  return (
    sync?.steps.some(
      (step) => step.key === key && step.status === "completed",
    ) ?? false
  );
}

export async function fetchOptional<T>(
  path: string,
  what: string,
): Promise<T | null> {
  const res = await apiFetch(path, { cache: "no-store" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}
