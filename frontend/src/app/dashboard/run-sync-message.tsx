import Link from "next/link";

import { EmptyState } from "./empty-state";

// Standard empty state for a tab whose sync step has not completed yet; see
// docs/wording.md.
export function RunSyncMessage({ action }: { action: string }) {
  return (
    <EmptyState>
      Run a sync in{" "}
      <Link
        href="/dashboard/account"
        className="underline hover:text-foreground"
      >
        Account
      </Link>{" "}
      to {action}.
    </EmptyState>
  );
}
