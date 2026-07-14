import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Standard container for missing-data messages (see docs/wording.md): a
// dashed placeholder box where the list content will eventually appear.
// The default is a roomy standalone panel; `sm` matches the compact padding
// of `Card size="sm"` for a ghost box sitting inline among those cards.
export function EmptyState({
  className,
  size = "default",
  children,
}: {
  className?: string;
  size?: "default" | "sm";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-lg border border-dashed px-6 text-center text-xs leading-5 text-balance text-muted-foreground",
        size === "sm" ? "py-3" : "py-10",
        className,
      )}
    >
      {children}
    </p>
  );
}

// One grid slot's worth of empty state: the ghost box sized like the result
// cards it stands in for, laid out in the same grid the results would use.
export function EmptyStateCell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {/* content-center, not flex: a flex container would split the message
          around inline elements (the Account pill) and swallow the spaces
          between them. */}
      <EmptyState className="content-center">{children}</EmptyState>
    </div>
  );
}
