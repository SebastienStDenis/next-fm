"use client";

import { useId } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SortSelect, type SortOption } from "./sort-select";

function FilterCheckbox({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <Label htmlFor={id} className="text-xs font-normal">
        {children}
      </Label>
    </div>
  );
}

// The filter/sort row shared by the Artists and Concerts tabs: the two
// artist-relation checkboxes plus the sort picker.
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
  onShowSuggested: (checked: boolean) => void;
  showKnown: boolean;
  onShowKnown: (checked: boolean) => void;
  sortKey: K;
  onSortKey: (key: K) => void;
  sortOptions: readonly SortOption<K>[];
  className?: string;
}) {
  return (
    <div className={cn(className, "flex flex-wrap items-center gap-x-4 gap-y-3")}>
      <div
        role="group"
        aria-label="Show"
        className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-1"
      >
        <FilterCheckbox checked={showSuggested} onCheckedChange={onShowSuggested}>
          Suggested artists
        </FilterCheckbox>
        <FilterCheckbox checked={showKnown} onCheckedChange={onShowKnown}>
          Artists you listen to
        </FilterCheckbox>
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
