import { InlineNav } from "../inline-nav";
import { EmptyState } from "./empty-state";

// Standard empty state for a tab whose sync step has not completed yet; see
// docs/wording.md.
export function RunSyncMessage({
  action,
  className,
}: {
  action: string;
  className?: string;
}) {
  return (
    <EmptyState className={className}>
      Run a sync in{" "}
      <InlineNav href="/dashboard/account">Account</InlineNav> to {action}.
    </EmptyState>
  );
}
