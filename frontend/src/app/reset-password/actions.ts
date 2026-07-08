"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { AuthState } from "../login/actions";

export async function setNewPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof password !== "string" || password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  // The recovery link established a session via /auth/confirm, so this updates
  // the signed-in user's password.
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }
  redirect("/dashboard");
}
