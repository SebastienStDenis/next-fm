"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// A failed email-link verification for a signed-in user lands on
// /dashboard?error=confirm (see /auth/confirm). The error renders as an inline
// notice in the server HTML rather than a toast: sonner can't paint anything
// until the client hydrates, and on a slow mobile load the heavy dashboard
// hydrates late enough that an auto-dismissing toast fires and vanishes
// unseen (#258). The notice is visible from first paint and stays until
// dismissed; hydration only adds the dismiss handler and strips the param so
// a refresh or Back doesn't replay it.
export function ConfirmErrorNotice() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("error")) {
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url);
    }
  }, []);

  if (dismissed) {
    return null;
  }
  return (
    <Alert variant="destructive" className="mb-6">
      <X strokeWidth={2.5} />
      <AlertTitle>That email link is invalid or has expired.</AlertTitle>
      <AlertAction>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  );
}
