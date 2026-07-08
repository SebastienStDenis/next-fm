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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: name.trim() } },
  });
  if (error) {
    return { error: error.message };
  }
  // With email confirmation on, Supabase does not error on a duplicate email
  // (to prevent enumeration); it returns a fake user with no identities. Surface
  // it as a duplicate rather than sending the user to the check-email page.
  if (data.user && data.user.identities?.length === 0) {
    return { error: "That email is already registered. Try logging in." };
  }
  // With email confirmation on, signUp returns no session until the user clicks
  // the emailed link; send them to a holding page instead of the dashboard
  // (the proxy would bounce an unauthenticated /dashboard visit to /login).
  redirect(data.session ? "/dashboard" : "/signup/check-email");
}
