"use server";

import { redirect, RedirectType } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { AuthState } from "../actions";

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = formData.get("email");
  if (typeof email !== "string" || !email) {
    return { error: "Enter your email." };
  }

  // The emailed link routes through /auth/confirm (type=recovery), which
  // signs the user in and lands them on /reset-password.
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    return { error: error.message };
  }
  redirect("/login/forgot-password/check-email", RedirectType.replace);
}
