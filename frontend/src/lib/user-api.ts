import { notFound } from "next/navigation";

import { apiFetch } from "@/lib/api";
import type { SyncStatus, SyncStepKey, User } from "@/lib/api-types";
import { createClient } from "@/lib/supabase/server";

export async function loadMe(): Promise<User> {
  const res = await apiFetch("/me");
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
  const res = await apiFetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}

// The latest sync run, if any. Best-effort: any transport or API error
// resolves to null so the page never breaks over status hints.
export async function loadSyncStatus(): Promise<SyncStatus | null> {
  try {
    const res = await apiFetch("/me/sync");
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
  key: SyncStepKey,
): boolean {
  return (
    sync?.steps.some(
      (step) => step.key === key && step.status === "completed",
    ) ?? false
  );
}

// Known artists are always requested; hiding them is a view-side filter in
// the events panel, independent of the user's global setting.
export function userEventsPath(geonameid?: number): string {
  const params = new URLSearchParams();
  if (geonameid !== undefined) {
    params.set("geonameid", String(geonameid));
  }
  params.set("include_known_artists", "true");
  return `/me/events?${params}`;
}

export async function fetchOptional<T>(
  path: string,
  what: string,
): Promise<T | null> {
  const res = await apiFetch(path);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}
