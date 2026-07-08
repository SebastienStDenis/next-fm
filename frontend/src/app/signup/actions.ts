"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { AuthState } from "../login/actions";

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = formData.get("name");
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "Enter a name." };
  }
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email ||
    !password
  ) {
    return { error: "Enter an email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: name.trim() } },
  });
  if (error) {
    return { error: error.message };
  }
  redirect("/dashboard");
}
