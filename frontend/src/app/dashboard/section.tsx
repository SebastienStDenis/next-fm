import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StepStatusMark } from "./step-status-mark";

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
          <StepStatusMark state={state} />
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
