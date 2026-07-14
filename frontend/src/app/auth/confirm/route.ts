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
  // Resolve `next` against our own origin and only accept a same-origin path;
  // a protocol-relative value like "//evil.com" would otherwise send the user
  // off-site after a successful verify.
  const origin = new URL(request.url).origin;
  const resolvedNext = next ? new URL(next, origin) : null;
  const redirectTo =
    resolvedNext && resolvedNext.origin === origin
      ? resolvedNext.pathname + resolvedNext.search
      : "/dashboard";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      if (type === "email_change") {
        // A secure email change is confirmed from two addresses. The first
        // link returns no session (the change is still pending); the second
        // establishes one and applies the change.
        return NextResponse.redirect(
          new URL(
            data.session
              ? "/dashboard?notice=email-changed"
              : "/auth/email-change-pending",
            request.url,
          ),
        );
      }
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
    // Verification failed. An email change is confirmed while still signed in,
    // so route the error to the dashboard - the proxy bounces a signed-in user
    // off /login, which would swallow the toast. Signed-out flows (signup,
    // recovery) still land on /login.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return NextResponse.redirect(
      new URL(
        user ? "/dashboard?error=confirm" : "/login?error=confirm",
        request.url,
      ),
    );
  }

  return NextResponse.redirect(new URL("/login?error=confirm", request.url));
}
