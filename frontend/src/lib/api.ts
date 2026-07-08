import "server-only";

import { cache } from "react";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

// Resolve the Supabase session once per request: a single dashboard render
// issues many apiFetch calls, and each would otherwise rebuild the server
// client and re-read the session cookie.
const currentSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
});

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await currentSession();
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
