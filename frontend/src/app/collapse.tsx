"use client";

import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Collapses its child to nothing and back by animating the grid track, so
// the surrounding layout (and any dialog frame around it) moves continuously
// with the content instead of snapping while a clip edge catches up. The
// child stays mounted; `inert` keeps its controls unfocusable while hidden.
export function Collapse({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  return (
    <div
      inert={!show}
      className={cn(
        "grid transition-[grid-template-rows] duration-250 ease-out motion-reduce:transition-none",
        show ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      {/* The horizontal padding/negative-margin pair pushes the clip edge
          out without moving anything, so input focus rings survive the
          overflow-hidden. Vertical padding would resist collapsing to 0. */}
      <div className="-mx-1 min-h-0 overflow-hidden px-1">
        {/* The content fades as a whole - in slightly after the track opens,
            out immediately as it closes - so the clip edge never reads as a
            top-to-bottom sweep across the text. */}
        <div
          className={cn(
            "transition-opacity duration-200 motion-reduce:transition-none",
            show ? "opacity-100 delay-100" : "opacity-0 delay-0",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
