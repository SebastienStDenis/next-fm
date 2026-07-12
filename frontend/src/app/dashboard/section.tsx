import { Check } from "lucide-react";

import { AttentionDot } from "./attention-dot";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// One titled settings card: heading, optional action-needed badge, italic
// description. Shared by the settings dialog and the welcome flow so both
// read as the same surface. The welcome flow marks progression with `state`
// instead of badge text: a pulsing dot on the step to do now, a green check
// on completed ones.
export function Section({
  heading,
  alert,
  alertText,
  state,
  description,
  children,
}: {
  heading: string;
  alert?: boolean;
  alertText?: string;
  state?: "active" | "done";
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {state === "active" && <AttentionDot pulse />}
          {state === "done" && (
            <Check
              aria-hidden
              className="size-3.5 text-green-600 dark:text-green-500"
              strokeWidth={2.5}
            />
          )}
          <h2>{heading}</h2>
          {alert && alertText && (
            <Badge
              variant="secondary"
              className="h-auto min-h-5 px-1.5 font-normal whitespace-normal"
            >
              <AttentionDot />
              {alertText}
            </Badge>
          )}
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
