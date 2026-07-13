import { Check } from "lucide-react";

import { AttentionDot } from "./attention-dot";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// One titled settings card: heading and italic description. Shared by the
// settings dialog and the welcome flow so both read as the same surface.
// The welcome flow marks progression with `state`: a pulsing dot on the
// step to do now, a green check on completed ones.
export function Section({
  heading,
  state,
  description,
  children,
}: {
  heading: string;
  state?: "active" | "done";
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Crossfade the pulsing dot (active) and the check (done) in one
              fixed-size slot: completing a step reads as a single smooth swap
              with no pop and no sideways nudge of the heading. The slot fades
              in on first appearance; the layers trade opacity thereafter. */}
          {state && (
            <span className="relative flex size-3.5 shrink-0 animate-fade-in">
              <span
                aria-hidden={state !== "active"}
                className={cn(
                  "absolute inset-0 flex items-center justify-center transition-opacity duration-[250ms] ease-out motion-reduce:transition-none",
                  state === "active"
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none",
                )}
              >
                <AttentionDot pulse={state === "active"} />
              </span>
              <Check
                aria-hidden
                strokeWidth={2.5}
                className={cn(
                  "absolute inset-0 size-3.5 text-green-600 transition-opacity duration-[250ms] ease-out motion-reduce:transition-none dark:text-green-500",
                  state === "done"
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none",
                )}
              />
            </span>
          )}
          <h2>{heading}</h2>
        </CardTitle>
        {description && (
          <CardDescription className="text-xs italic">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
