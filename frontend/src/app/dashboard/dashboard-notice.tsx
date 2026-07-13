"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Auth redirects land on the dashboard with a `?notice=` value; show it once
// as a toast and strip the param so a refresh or Back doesn't replay it.
const NOTICES: Record<string, string> = {
  "password-reset": "Password changed. You're signed in.",
  "email-changed": "Email changed.",
};

export function DashboardNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const notice = params.get("notice");
  const shown = useRef(false);

  useEffect(() => {
    if (!notice || shown.current) {
      return;
    }
    shown.current = true;
    const message = NOTICES[notice];
    if (message) {
      toast.success(message);
    }
    router.replace(pathname, { scroll: false });
  }, [notice, pathname, router]);

  return null;
}
