"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export type LastfmActionState = {
  error: string | null;
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

export async function deleteUser(userId: string): Promise<LastfmActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}`, { method: "DELETE" });
  if (!res.ok) {
    return { error: await errorMessage(res, "Failed to delete user.") };
  }

  revalidatePath("/users");
  redirect("/users");
}
