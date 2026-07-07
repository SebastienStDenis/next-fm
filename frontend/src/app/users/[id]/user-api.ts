import { notFound } from "next/navigation";

export type User = {
  id: string;
  name: string;
  include_known_artists: boolean;
};

export const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function loadUser(id: string): Promise<User> {
  const res = await fetch(`${apiUrl}/users/${id}`, { cache: "no-store" });
  if (res.status === 404 || res.status === 422) {
    notFound();
  }
  if (!res.ok) {
    throw new Error(`Failed to load user: ${res.status}`);
  }
  return res.json();
}

export async function fetchJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}

// True when no sync run exists for the user yet. Best-effort: any transport
// or Temporal error resolves to false so the page never breaks over a dot.
export async function loadNeverSynced(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/users/${id}/sync`, { cache: "no-store" });
    if (!res.ok) {
      return false;
    }
    const data: { status: string } = await res.json();
    return data.status === "none";
  } catch {
    return false;
  }
}

export async function fetchOptional<T>(
  url: string,
  what: string,
): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}
