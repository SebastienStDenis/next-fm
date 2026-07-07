"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export type ActionState = {
  error: string | null;
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
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, init);
  } catch {
    return { error: fallback };
  }
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

export async function startSync(userId: string): Promise<ActionState> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/users/${userId}/sync`, { method: "POST" });
  } catch {
    return { error: "Failed to start sync." };
  }
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to start sync.") };
  }

  return { error: null };
}

export async function setIncludeKnownArtists(
  userId: string,
  includeKnownArtists: boolean,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_known_artists: includeKnownArtists }),
    },
    "Failed to update the setting.",
    `/users/${userId}`,
  );
}

export async function createCityPlaylist(
  userId: string,
  geonameid: number,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}/playlists`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to create playlist.",
    `/users/${userId}`,
  );
}

export async function deletePlaylist(
  userId: string,
  playlistId: string,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}/playlists/${playlistId}`,
    { method: "DELETE" },
    "Failed to delete playlist.",
    `/users/${userId}`,
  );
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
