import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// Temporary outage note shown under the mark on the landing and dashboard
// pages while Bandsintown API access is restricted; remove once it's back.
export function UnavailableNotice({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", className)}>
      <X
        aria-hidden
        className="mt-px size-3.5 shrink-0 text-destructive"
        strokeWidth={2.5}
      />
      <span className="text-balance">
        NextFM is currently unavailable due to Bandsintown API restrictions.
        Please check back later.
      </span>
    </p>
  );
}
