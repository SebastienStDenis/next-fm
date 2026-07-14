"use client";

import { usePathname } from "next/navigation";

import { SoundwaveDots } from "./soundwave-dots";

// The soundwave field is ambient decoration for the landing and auth pages.
// The logged-in app (welcome, dashboard) and the content-heavy about page stay
// still so the motion doesn't compete with what's on screen.
const HIDDEN_PREFIXES = ["/welcome", "/dashboard", "/about"];

export function SoundwaveBackground() {
  const pathname = usePathname();
  const hidden = HIDDEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (hidden) return null;
  return <SoundwaveDots />;
}
