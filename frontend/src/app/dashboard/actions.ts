"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export type ActionState = {
  error: string | null;
};

export type MessageState = {
  error: string | null;
  success: string | null;
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

  return callApi(
    `/me/lastfm`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim() }),
    },
    "Failed to link Last.fm account.",
    `/dashboard/account`,
  );
}

export async function refreshLastfm(): Promise<ActionState> {
  return callApi(
    `/me/lastfm/refresh`,
    { method: "POST" },
    "Failed to refresh Last.fm account.",
    `/dashboard/account`,
  );
}

export async function unlinkLastfm(): Promise<ActionState> {
  return callApi(
    `/me/lastfm`,
    { method: "DELETE" },
    "Failed to unlink Last.fm account.",
    `/dashboard/account`,
  );
}

export async function setCity(geonameid: number): Promise<ActionState> {
  return callApi(
    `/me/city`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to set city.",
    `/dashboard`,
  );
}

export async function clearCity(): Promise<ActionState> {
  return callApi(
    `/me/city`,
    { method: "DELETE" },
    "Failed to clear city.",
    `/dashboard`,
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

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function changePassword(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof password !== "string" || password.length < 6) {
    return { error: "Password must be at least 6 characters.", success: null };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match.", success: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message, success: null };
  }
  return { error: null, success: "Password updated." };
}

export async function changeEmail(
  _prev: MessageState,
  formData: FormData,
): Promise<MessageState> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return { error: "Enter a new email address.", success: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: email.trim() });
  if (error) {
    return { error: error.message, success: null };
  }
  // double_confirm_changes is on, so GoTrue emails a link to both the current
  // and the new address; the change only lands once both are confirmed.
  return {
    error: null,
    success:
      "Confirmation links sent. Check both your current and new inboxes to finish the change.",
  };
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
  redirect("/");
}
