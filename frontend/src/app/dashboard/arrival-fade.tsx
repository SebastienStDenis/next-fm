"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Matches --animate-fade-in in globals.css.
const FADE_MS = 250;

// Fades data-backed content in as it replaces its loading placeholder. The
// fade plays once: the panels live in tabs hidden with display:none, and a
// CSS animation restarts every time its element is shown again, so the class
// comes off once the arrival fade has run.
export function ArrivalFade({
  as: Tag = "div",
  className,
  children,
}: {
  as?: "div" | "span";
  className?: string;
  children: ReactNode;
}) {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArrived(true), FADE_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <Tag className={cn(!arrived && "animate-fade-in", className)}>
      {children}
    </Tag>
  );
}
