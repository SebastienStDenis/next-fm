import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/login/forgot-password",
  "/login/forgot-password/check-email",
  "/signup",
  "/signup/check-email",
  "/about",
]);

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refreshes the session if expired; nothing may run between client
  // creation and this call, per @supabase/ssr docs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // API routes answer JSON; they handle missing sessions themselves rather
  // than redirecting a fetch() to an HTML login page.
  if (
    !user &&
    !PUBLIC_PATHS.has(pathname) &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  if (
    user &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/signup/check-email")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Must return this exact response object so refreshed cookies survive.
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
