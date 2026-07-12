"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { type LastfmAccount } from "../dashboard/lastfm-panel";
import { apiFetch } from "@/lib/api";

export type LinkLastfmResult =
  | { account: LastfmAccount; error: null }
  | { account: null; error: string };

// Unlike the settings dialog's linkLastfm, the welcome flow shows the linked
// account without a page reload, so this returns the API payload.
export async function linkLastfmAccount(
  username: string,
): Promise<LinkLastfmResult> {
  const fallback = "Failed to link Last.fm account.";
  let res: Response;
  try {
    res = await apiFetch(`/me/lastfm`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
  } catch (e) {
    unstable_rethrow(e);
    return { account: null, error: fallback };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return {
      account: null,
      error: typeof body?.detail === "string" ? body.detail : fallback,
    };
  }

  revalidatePath(`/dashboard`);
  return { account: await res.json(), error: null };
}
