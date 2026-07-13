"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType, unstable_rethrow } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

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
  revalidateType?: "page" | "layout",
): Promise<ActionState> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch (e) {
    unstable_rethrow(e);
    return { error: fallback };
  }
  if (!res.ok) {
    return { error: await errorMessage(res, fallback) };
  }

  revalidatePath(revalidate, revalidateType);
  return { error: null };
}

export async function linkLastfm(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = formData.get("username");
  if (typeof username !== "string" || username.trim() === "") {
    return { error: "Enter a Last.fm username." };
  }

  // Root-layout revalidation: the panel is shared by the settings dialog
  // and the welcome flow, and both pages' server payloads must refresh.
  return callApi(
    `/me/lastfm`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim() }),
    },
    "Failed to link Last.fm account.",
    `/`,
    "layout",
  );
}

export async function refreshLastfm(): Promise<ActionState> {
  return callApi(
    `/me/lastfm/refresh`,
    { method: "POST" },
    "Failed to refresh Last.fm account.",
    `/dashboard`,
  );
}

export async function setCity(geonameid: number): Promise<ActionState> {
  // Root-layout revalidation: the panel is shared by the settings dialog
  // and the welcome flow, and both pages' server payloads must refresh.
  return callApi(
    `/me/city`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to set city.",
    `/`,
    "layout",
  );
}

export async function startSync(): Promise<ActionState> {
  let res: Response;
  try {
    res = await apiFetch(`/me/sync`, { method: "POST" });
  } catch (e) {
    unstable_rethrow(e);
    return { error: "Failed to start sync." };
  }
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to start sync.") };
  }

  // The welcome page's step marks read the run state server-side; refresh
  // them so the sync step's dot clears while the run is in flight.
  revalidatePath(`/`, "layout");
  return { error: null };
}

export async function setIncludeKnownArtists(
  includeKnownArtists: boolean,
): Promise<ActionState> {
  return callApi(
    `/me`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_known_artists: includeKnownArtists }),
    },
    "Failed to update the setting.",
    `/dashboard`,
  );
}

export async function setArtistHidden(
  artistId: string,
  hidden: boolean,
): Promise<ActionState> {
  // Unlike callApi, never surface the response's detail: the row has no room
  // for prose, and a stale backend answers with an unhelpful route-miss
  // "Not Found".
  const failure = {
    error: hidden ? "Failed to hide" : "Failed to unhide",
  };
  let res: Response;
  try {
    res = await apiFetch(`/me/artists/${artistId}/exclusion`, {
      method: hidden ? "PUT" : "DELETE",
    });
  } catch (e) {
    unstable_rethrow(e);
    return failure;
  }
  if (!res.ok) {
    return failure;
  }

  revalidatePath(`/dashboard`, "layout");
  return { error: null };
}

export async function createCityPlaylist(
  geonameid: number,
): Promise<ActionState> {
  return callApi(
    `/me/playlists`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to create playlist.",
    `/dashboard`,
    "layout",
  );
}

export async function deletePlaylist(playlistId: string): Promise<ActionState> {
  return callApi(
    `/me/playlists/${playlistId}`,
    { method: "DELETE" },
    "Failed to delete playlist.",
    `/dashboard`,
    "layout",
  );
}

export async function changePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const currentPassword = formData.get("currentPassword");
  const password = formData.get("password");
  if (typeof currentPassword !== "string" || !currentPassword) {
    return { error: "Enter your current password." };
  }
  if (typeof password !== "string" || !password) {
    return { error: "Enter a new password." };
  }

  // updateUser alone accepts any live session; re-checking the current
  // password keeps someone at an unlocked device from taking the account.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { error: "Failed to change password." };
  }
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) {
    return { error: "Current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

export async function changeEmail(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email) {
    return { error: "Enter a new email." };
  }

  // Sends confirmation links to both the current and the new address
  // (double_confirm_changes); the change applies once both are clicked.
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Server Action redirects default to push; replace so Back from the home
  // page doesn't land on /dashboard, which the proxy bounces forward again.
  redirect("/", RedirectType.replace);
}

export async function deleteAccount(): Promise<ActionState> {
  let res: Response;
  try {
    res = await apiFetch("/me", { method: "DELETE" });
  } catch (e) {
    unstable_rethrow(e);
    return { error: "Failed to delete account." };
  }
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to delete account.") };
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/", RedirectType.replace);
}
