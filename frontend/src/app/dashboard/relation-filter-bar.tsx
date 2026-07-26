"use client";

import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { SortSelect, type SortOption } from "./sort-select";

// The filter/sort row shared by the Artists and Concerts tabs: the two
// artist-relation toggles plus the sort picker.
export function RelationFilterBar<K extends string>({
  showSuggested,
  onShowSuggested,
  showKnown,
  onShowKnown,
  sortKey,
  onSortKey,
  sortOptions,
  className,
}: {
  showSuggested: boolean;
  onShowSuggested: (pressed: boolean) => void;
  showKnown: boolean;
  onShowKnown: (pressed: boolean) => void;
  sortKey: K;
  onSortKey: (key: K) => void;
  sortOptions: readonly SortOption<K>[];
  className?: string;
}) {
  return (
    <div className={cn(className, "flex flex-wrap items-center gap-x-4 gap-y-2.5")}>
      <div className="flex flex-wrap gap-2">
        <Toggle
          variant="outline"
          size="sm"
          pressed={showSuggested}
          onPressedChange={onShowSuggested}
        >
          Suggested artists
        </Toggle>
        <Toggle
          variant="outline"
          size="sm"
          pressed={showKnown}
          onPressedChange={onShowKnown}
        >
          Artists you listen to
        </Toggle>
      </div>
      {/* ml-auto rather than justify-between on the row: it also keeps the
          picker right-aligned when it wraps to its own line. */}
      <SortSelect
        value={sortKey}
        onValueChange={onSortKey}
        options={sortOptions}
        className="ml-auto"
      />
    </div>
  );
}
