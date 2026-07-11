import { cn } from "@/lib/utils";

export function AttentionDot({
  pulse = false,
  className,
}: {
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      title="Action needed"
      className={cn(
        "mr-1.5 inline-block h-2 w-2 rounded-full bg-destructive align-middle",
        pulse && "animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}
