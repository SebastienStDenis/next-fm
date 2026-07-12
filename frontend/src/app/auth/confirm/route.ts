import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Verifies the token hash from a Supabase auth email (signup confirmation,
// password recovery, email change) and, on success, lands the now-signed-in
// user on the dashboard or the link's `next` path (the recovery email passes
// /reset-password). Reachable while signed out (the proxy treats /auth as
// public).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  const redirectTo = next?.startsWith("/") ? next : "/dashboard";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirm", request.url));
}
