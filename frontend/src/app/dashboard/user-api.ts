import { notFound } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
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

// The signed-in email lives in Supabase Auth, not the API's user record.
export async function loadEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
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

// When the latest sync run completed the given step, the run's finish time -
// the closest thing to a per-step success time /me/sync reports.
export function syncStepCompletedAt(
  sync: SyncStatus | null,
  key: string,
): string | null {
  return syncStepCompleted(sync, key) ? (sync?.finished_at ?? null) : null;
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
