"use server";

import { redirect, RedirectType } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { AuthState } from "../login/actions";

export async function resetPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = formData.get("password");
  if (typeof password !== "string" || !password) {
    return { error: "Enter a new password." };
  }

  // The recovery link already signed the user in (via /auth/confirm), so
  // this is a plain password update on the current session.
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }
  redirect("/dashboard", RedirectType.replace);
}
