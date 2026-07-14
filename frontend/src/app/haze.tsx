import { cn } from "@/lib/utils";

// A feathered wash of the page background, sized to whatever it wraps, so
// content stays legible over the animated soundwave dots without a hard-edged
// card. A blurred rounded rectangle (rather than a radial gradient) covers wide
// text evenly to the edges.
export function Haze({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -inset-y-0.5 rounded-3xl bg-background blur-md"
      />
      <div className="relative">{children}</div>
    </div>
  );
}
