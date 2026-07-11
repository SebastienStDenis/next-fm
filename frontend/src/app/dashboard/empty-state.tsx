import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Standard container for missing-data messages (see docs/wording.md): a
// dashed placeholder box where the list content will eventually appear.
export function EmptyState({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
