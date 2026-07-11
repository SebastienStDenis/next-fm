import { cn } from "@/lib/utils";

// The fade-in lives on a wrapper because animate-fade-in and animate-pulse
// both set `animation` and would cancel each other on one element.
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
        "mr-1.5 inline-block animate-fade-in align-middle",
        className,
      )}
    >
      <span
        className={cn(
          "block h-2 w-2 rounded-full bg-destructive",
          pulse && "animate-pulse motion-reduce:animate-none",
        )}
      />
    </span>
  );
}
