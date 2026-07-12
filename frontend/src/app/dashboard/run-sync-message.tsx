import { InlineNav } from "../inline-nav";
import { EmptyStateCell } from "./empty-state";
import { SETTINGS_HASH } from "./settings-dialog";

// Standard empty state for a tab whose sync step has not completed yet; see
// docs/wording.md.
export function RunSyncMessage({ action }: { action: string }) {
  return (
    <EmptyStateCell>
      Run a sync in{" "}
      <InlineNav href={SETTINGS_HASH}>Settings</InlineNav> to {action}.
    </EmptyStateCell>
  );
}
