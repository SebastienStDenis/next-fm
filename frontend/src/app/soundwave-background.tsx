"use client";

import { usePathname } from "next/navigation";

import { SoundwaveDots } from "./soundwave-dots";

// The soundwave field is ambient decoration for the marketing and auth pages.
// The logged-in app (welcome, dashboard) stays still so it doesn't compete with
// the data on screen.
const HIDDEN_PREFIXES = ["/welcome", "/dashboard"];

export function SoundwaveBackground() {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (hidden) return null;
  return <SoundwaveDots />;
}
