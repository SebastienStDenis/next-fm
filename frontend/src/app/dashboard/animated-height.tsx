"use client";

import { useEffect, useRef, useState } from "react";

// Transitions the wrapper's height to follow its content, so a panel that
// swaps states (link form <-> account card) reflows the page smoothly
// instead of snapping. Until the first measurement the height is the
// content's own, so nothing animates on mount.
export function AnimatedHeight({ children }: { children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    // offsetHeight is the layout size: unlike getBoundingClientRect it
    // ignores transforms, so a scale animation on an ancestor (the dialog's
    // zoom-in) can't bake a too-small height into the wrapper.
    const observer = new ResizeObserver(() => {
      setHeight(content.offsetHeight);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    // The height is the content box (box-content), and the padding/negative-
    // margin pair pushes the clip edge out without moving anything, so focus
    // rings at the content's edge survive the overflow-hidden.
    <div
      style={height === null ? undefined : { height }}
      className="-m-1 box-content overflow-hidden p-1 transition-[height] duration-250 ease-out motion-reduce:transition-none"
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
