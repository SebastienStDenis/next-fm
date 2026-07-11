import Link from "next/link";

import { EmptyState } from "./empty-state";

// Standard empty state for a tab whose sync step has not completed yet; see
// docs/wording.md. The accent dot marks the nudge as actionable, so it only
// shows while sync is enabled.
export function RunSyncMessage({
  action,
  syncEnabled,
}: {
  action: string;
  syncEnabled: boolean;
}) {
  return (
    <EmptyState>
      {syncEnabled && (
        <span
          className="mr-1.5 inline-block size-1.5 -translate-y-px animate-fade-in rounded-full bg-primary align-middle"
          aria-hidden
        />
      )}
      Run a sync in{" "}
      <Link
        href="/dashboard/account"
        className="underline underline-offset-4 hover:text-foreground"
      >
        Account
      </Link>{" "}
      to {action}.
    </EmptyState>
  );
}
