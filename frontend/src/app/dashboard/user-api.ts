import { notFound } from "next/navigation";

import { apiFetch } from "@/lib/api";

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

// True when the user has never completed a sync: the "get started" nudge.
// last_synced_at is the durable success record; a retained completed run also
// counts (it predates the column), and a running first sync isn't nudged.
// Best-effort: any transport or Temporal error resolves to false so the page
// never breaks over a dot.
export async function loadNeverSynced(user: User): Promise<boolean> {
  if (user.last_synced_at !== null) {
    return false;
  }
  try {
    const res = await apiFetch("/me/sync", { cache: "no-store" });
    if (!res.ok) {
      return false;
    }
    const data: { status: string } = await res.json();
    return data.status === "none" || data.status === "failed";
  } catch {
    return false;
  }
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
