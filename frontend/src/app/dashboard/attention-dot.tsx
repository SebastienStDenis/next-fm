import { cn } from "@/lib/utils";

// Carries no margin of its own: the containers it sits in (badges, buttons)
// space it with their own gap.
export function AttentionDot({ pulse = false }: { pulse?: boolean }) {
  return (
    <span
      title="Action needed"
      className={cn(
        "inline-block h-2 w-2 rounded-full bg-destructive align-middle",
        pulse && "animate-pulse motion-reduce:animate-none",
      )}
    />
  );
}
