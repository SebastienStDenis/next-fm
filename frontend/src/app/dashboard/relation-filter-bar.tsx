"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SortSelect, type SortOption } from "./sort-select";

// The filter/sort row shared by the Artists and Concerts tabs: suggestions
// always show, the switch adds artists you listen to, plus the sort picker.
export function RelationFilterBar<K extends string>({
  showKnown,
  onShowKnown,
  sortKey,
  onSortKey,
  sortOptions,
  className,
}: {
  showKnown: boolean;
  onShowKnown: (checked: boolean) => void;
  sortKey: K;
  onSortKey: (key: K) => void;
  sortOptions: readonly SortOption<K>[];
  className?: string;
}) {
  const switchId = useId();
  return (
    <div className={cn(className, "flex flex-wrap items-center gap-x-4 gap-y-3")}>
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          size="sm"
          checked={showKnown}
          onCheckedChange={onShowKnown}
        />
        <Label
          htmlFor={switchId}
          className="text-xs font-normal text-muted-foreground"
        >
          Include artists I know
        </Label>
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
