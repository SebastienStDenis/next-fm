import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    // The proxy guards pages, so this only fires on expiry races.
    redirect("/");
  }
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}
