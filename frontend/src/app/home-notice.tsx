"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Deleting an account signs the user out and lands them here, which is exactly
// where signing out lands them too; the toast is what tells the two apart.
// Show it once and strip the param so a refresh or Back doesn't replay it.
const NOTICES: Record<string, string> = {
  "account-deleted": "Account deleted.",
};

export function HomeNotice() {
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
