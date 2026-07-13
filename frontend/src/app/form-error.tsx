import { type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// Form-level error message. The red X carries the error signal (matching the
// failed sync-step mark), which lets the text stay neutral foreground rather
// than adding a second layer of red - quieter, but still unmistakably an error.
export function FormError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-sm text-foreground",
        className,
      )}
    >
      <span className="flex h-5 shrink-0 items-center">
        <X
          aria-hidden
          strokeWidth={2.5}
          className="size-3.5 text-destructive"
        />
      </span>
      <span>{children}</span>
    </p>
  );
}
