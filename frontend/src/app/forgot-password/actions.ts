"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { AuthState } from "../login/actions";

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return { error: "Enter your email." };
  }

  const supabase = await createClient();
  // GoTrue does not reveal whether the address exists, so a successful call
  // says nothing about account existence; always land on the same page.
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  if (error) {
    return { error: error.message };
  }
  redirect("/forgot-password/check-email");
}
