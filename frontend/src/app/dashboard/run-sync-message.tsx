import { InlineNav } from "../inline-nav";
import { EmptyStateCell } from "./empty-state";
import { SETTINGS_HASH } from "./settings-dialog";

// Standard wording for a list whose sync step has not completed yet; see
// docs/wording.md.
export function RunSyncText({ action }: { action: string }) {
  return (
    <>
      Run a sync in <InlineNav href={SETTINGS_HASH}>Settings</InlineNav> to{" "}
      {action}.
    </>
  );
}

// The standard wording as a tab's full empty state.
export function RunSyncMessage({ action }: { action: string }) {
  return (
    <EmptyStateCell>
      <RunSyncText action={action} />
    </EmptyStateCell>
  );
}
