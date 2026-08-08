import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// Temporary outage note shown on the landing and dashboard pages while
// Bandsintown API access is restricted; remove once it's back. Carries the
// card chrome itself so it reads as a standing status card, not a toast.
export function UnavailableNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2.5 rounded-xl bg-card px-4 py-3 text-sm text-card-foreground shadow-card ring-1 ring-foreground/10",
        className,
      )}
    >
      <X
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-destructive"
        strokeWidth={2.5}
      />
      <span className="text-balance">
        NextFM is currently unavailable due to Bandsintown API restrictions.
        Please check back later.
      </span>
    </p>
  );
}
