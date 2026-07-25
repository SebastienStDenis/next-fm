"use client";

import { createContext, useContext, type ReactNode } from "react";

// Whether the surface a subtree belongs to is the one on screen. Surfaces that
// stay mounted while hidden (tab panels) mark their subtree, so anything that
// portals out of it can bow out with them: a Popover left open on a hidden
// panel would otherwise keep rendering, and, with its trigger no longer laid
// out, re-anchor to the page's top-left corner. True outside such a surface.
const OnScreenContext = createContext(true);

export function useOnScreen() {
  return useContext(OnScreenContext);
}

export function OnScreen({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <OnScreenContext.Provider value={value}>
      {children}
    </OnScreenContext.Provider>
  );
}
