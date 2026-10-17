"use client";

import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SortOption<K extends string> = { value: K; label: string };

// The one "Sort by" control shared by every list panel, so they stay visually
// and behaviorally identical.
export function SortSelect<K extends string>({
  value,
  onValueChange,
  options,
  className = "",
}: {
  value: K;
  onValueChange: (value: K) => void;
  options: readonly SortOption<K>[];
  className?: string;
}) {
  const labelId = useId();
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span id={labelId}>Sort by</span>
      <Select value={value} onValueChange={(next) => onValueChange(next as K)}>
        <SelectTrigger size="sm" aria-labelledby={labelId} className="text-xs">
          {/* Explicit label so the server-rendered HTML carries it; Radix
              otherwise fills it in only after hydration, and the box
              renders empty until then. */}
          <SelectValue>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
