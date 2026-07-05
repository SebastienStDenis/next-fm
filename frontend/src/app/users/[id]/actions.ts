"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export type LastfmActionState = {
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

export async function linkLastfm(
  userId: string,
  _prev: LastfmActionState,
  formData: FormData,
): Promise<LastfmActionState> {
  const username = formData.get("username");
  if (typeof username !== "string" || username.trim() === "") {
    return { error: "Enter a Last.fm username." };
  }

  const res = await fetch(`${apiUrl}/users/${userId}/lastfm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim() }),
  });
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to link Last.fm account.") };
  }

  revalidatePath(`/users/${userId}`);
  return { error: null };
}

export async function refreshLastfm(userId: string): Promise<LastfmActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/lastfm/refresh`, {
    method: "POST",
  });
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to refresh Last.fm account.") };
  }

  revalidatePath(`/users/${userId}`);
  return { error: null };
}

export async function unlinkLastfm(userId: string): Promise<LastfmActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/lastfm`, {
    method: "DELETE",
  });
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to unlink Last.fm account.") };
  }

  revalidatePath(`/users/${userId}`);
  return { error: null };
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

export async function deleteUser(userId: string): Promise<LastfmActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}`, { method: "DELETE" });
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to delete user.") };
  }

  revalidatePath("/users");
  redirect("/users");
}
