"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType, unstable_rethrow } from "next/navigation";

import { apiFetch } from "@/lib/api";
import type { ActionState } from "@/lib/action-state";
import { authErrorMessage } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/server";

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : fallback;
}

async function callApi(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
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
  // The welcome page's step marks read the run state server-side; refresh
  // them so the sync step's dot clears while the run is in flight.
  return callApi(
    `/me/sync`,
    { method: "POST" },
    "Failed to start sync.",
    `/`,
    "layout",
  );
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

  // Passing current_password satisfies GoTrue's secure-password-change gate
  // (Security.UpdatePasswordRequireCurrentPassword) when it is on; when it is
  // off the field is ignored and the signInWithPassword check above still
  // guards the change.
  const { error } = await supabase.auth.updateUser({
    password,
    current_password: currentPassword,
  });
  if (error) {
    return { error: authErrorMessage(error, "Failed to change password.") };
  }
  return { error: null };
}

export async function changeName(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = formData.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "Enter a name." };
  }

  // Root-layout revalidation: the name drives the dashboard and welcome
  // greetings as well as this settings card, so refresh every page's payload.
  return callApi(
    `/me`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    },
    "Failed to change name.",
    `/`,
    "layout",
  );
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
    return {
      error: authErrorMessage(error, "Failed to change email.", {
        email_exists: "That email is already in use.",
        validation_failed: "Enter a valid email address.",
        email_address_invalid: "Enter a valid email address.",
        email_address_not_authorized: "That email address isn't allowed.",
      }),
    };
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
  redirect("/?notice=account-deleted", RedirectType.replace);
}
