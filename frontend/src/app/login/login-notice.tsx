"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// /auth/confirm redirects here with an `?error=` value when an emailed link's
// token is invalid or expired; show it once as a toast and strip the param so
// a refresh or Back doesn't replay it.
const ERRORS: Record<string, string> = {
  confirm: "That email link is invalid or has expired.",
};

export function LoginNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const error = params.get("error");
  const shown = useRef(false);

  useEffect(() => {
    if (!error || shown.current) {
      return;
    }
    shown.current = true;
    const message = ERRORS[error];
    if (message) {
      toast.error(message);
    }
    router.replace(pathname, { scroll: false });
  }, [error, pathname, router]);

  return null;
}
