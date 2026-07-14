"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Auth redirects land on the dashboard with a `?notice=` (success) or `?error=`
// (a failed email link, since the change is confirmed while signed in) value;
// show it once as a toast and strip the param so a refresh or Back doesn't
// replay it.
const NOTICES: Record<string, string> = {
  "password-reset": "Password changed. You're signed in.",
  "email-changed": "Email changed.",
};
const ERRORS: Record<string, string> = {
  confirm: "That email link is invalid or has expired.",
};

export function DashboardNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const notice = params.get("notice");
  const error = params.get("error");
  const shown = useRef(false);

  useEffect(() => {
    if ((!notice && !error) || shown.current) {
      return;
    }
    shown.current = true;
    if (notice && NOTICES[notice]) {
      toast.success(NOTICES[notice]);
    }
    if (error && ERRORS[error]) {
      toast.error(ERRORS[error]);
    }
    router.replace(pathname, { scroll: false });
  }, [notice, error, pathname, router]);

  return null;
}
