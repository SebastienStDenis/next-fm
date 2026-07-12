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
// read as the same surface.
export function Section({
  heading,
  alert,
  alertText,
  description,
  children,
}: {
  heading: string;
  alert?: boolean;
  alertText?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
