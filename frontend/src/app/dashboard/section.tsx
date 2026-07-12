import { Check } from "lucide-react";

import { AttentionDot } from "./attention-dot";
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
          {/* The dot pulses (its own animation), so the fade lives on a
              wrapper instead. */}
          {state === "active" && (
            <span className="flex animate-fade-in">
              <AttentionDot pulse />
            </span>
          )}
          {state === "done" && (
            <Check
              aria-hidden
              className="size-3.5 animate-fade-in text-green-600 dark:text-green-500"
              strokeWidth={2.5}
            />
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
