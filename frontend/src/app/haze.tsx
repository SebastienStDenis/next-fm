import { cn } from "@/lib/utils";

// A feathered wash of the page background, sized to whatever it wraps, so
// content stays legible over the animated soundwave dots without a hard-edged
// card. A blurred rounded rectangle (rather than a radial gradient) covers wide
// text evenly to the edges. A second, backdrop-filtering layer softens the
// dots themselves under the wash: element blur feathers the wash's edges but
// never touches what's behind it, so the frost needs its own layer.
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
        className="pointer-events-none absolute -inset-x-4 -inset-y-0.5 rounded-3xl bg-background blur-md glass:bg-(--glass-wash)"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -inset-y-0.5 rounded-3xl glass:backdrop-blur-[5px]"
      />
      <div className="relative">{children}</div>
    </div>
  );
}
