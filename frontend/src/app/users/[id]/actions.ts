"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export type ActionState = {
  error: string | null;
};

export type SyncArtistsActionState = {
  error: string | null;
  summary: string | null;
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : fallback;
}

async function callApi(
  path: string,
  init: RequestInit,
  fallback: string,
  revalidate: string,
): Promise<ActionState> {
  const res = await fetch(`${apiUrl}${path}`, init);
  if (!res.ok) {
    return { error: await errorMessage(res, fallback) };
  }

  revalidatePath(revalidate);
  return { error: null };
}

export async function linkLastfm(
  userId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = formData.get("username");
  if (typeof username !== "string" || username.trim() === "") {
    return { error: "Enter a Last.fm username." };
  }

  return callApi(
    `/users/${userId}/lastfm`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim() }),
    },
    "Failed to link Last.fm account.",
    `/users/${userId}`,
  );
}

export async function refreshLastfm(userId: string): Promise<ActionState> {
  return callApi(
    `/users/${userId}/lastfm/refresh`,
    { method: "POST" },
    "Failed to refresh Last.fm account.",
    `/users/${userId}`,
  );
}

export async function unlinkLastfm(userId: string): Promise<ActionState> {
  return callApi(
    `/users/${userId}/lastfm`,
    { method: "DELETE" },
    "Failed to unlink Last.fm account.",
    `/users/${userId}`,
  );
}

export async function setCity(
  userId: string,
  geonameid: number,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}/city`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to set city.",
    `/users/${userId}`,
  );
}

export async function clearCity(userId: string): Promise<ActionState> {
  return callApi(
    `/users/${userId}/city`,
    { method: "DELETE" },
    "Failed to clear city.",
    `/users/${userId}`,
  );
}

type SyncArtistsResponse = {
  results: {
    kind: string;
    artists: number;
    interests_created: number;
    interests_updated: number;
    interests_removed: number;
  }[];
};

export async function syncLastfmArtists(
  userId: string,
): Promise<SyncArtistsActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/lastfm/artists/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    return {
      error: await errorMessage(res, "Failed to sync artists."),
      summary: null,
    };
  }

  const body: SyncArtistsResponse = await res.json();
  const artists = body.results.reduce((sum, r) => sum + r.artists, 0);
  const created = body.results.reduce((sum, r) => sum + r.interests_created, 0);
  const updated = body.results.reduce((sum, r) => sum + r.interests_updated, 0);
  const removed = body.results.reduce((sum, r) => sum + r.interests_removed, 0);
  const summary = `Synced ${artists} ${artists === 1 ? "artist" : "artists"} · ${created} added, ${updated} updated, ${removed} removed`;

  revalidatePath(`/users/${userId}`);
  return { error: null, summary };
}

type SyncEventsResponse = {
  artists_total: number;
  artists_synced: number;
  artists_skipped: number;
  artists_unknown: number;
  events_created: number;
  events_updated: number;
  events_removed: number;
};

export async function syncEvents(
  userId: string,
): Promise<SyncArtistsActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/events/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    return {
      error: await errorMessage(res, "Failed to sync events."),
      summary: null,
    };
  }

  const body: SyncEventsResponse = await res.json();
  const checked = `Checked ${body.artists_total} ${body.artists_total === 1 ? "artist" : "artists"} (${body.artists_skipped} fresh, ${body.artists_unknown} not on Bandsintown)`;
  const summary = `${checked} · ${body.events_created} events added, ${body.events_updated} updated, ${body.events_removed} removed`;

  revalidatePath(`/users/${userId}`);
  return { error: null, summary };
}

export async function deleteUser(userId: string): Promise<ActionState> {
  const result = await callApi(
    `/users/${userId}`,
    { method: "DELETE" },
    "Failed to delete user.",
    "/users",
  );
  if (result.error) {
    return result;
  }

  redirect("/users");
}
