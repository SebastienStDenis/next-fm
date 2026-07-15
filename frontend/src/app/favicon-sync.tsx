"use client";

import { useEffect, useState } from "react";

// Renders the favicon link itself, so the icon tracks the browser's scheme as
// it changes. Pointing the link at a different file is the only mechanism that
// works live in every engine: Chrome rasterizes an SVG favicon once and won't
// re-evaluate a prefers-color-scheme query baked into it until the tab
// reloads, Safari never evaluates one, and Firefox ignores a media attribute
// on the link. The scheme is read from the browser rather than next-themes
// because the icon sits in browser chrome, not on the page.
//
// The link is rendered rather than mutated because Next renders `metadata` as
// part of the React tree: an imperative href change gets duplicated by the
// next render instead of kept. It follows that this is the only icon link -
// there is no `icons` entry in the root metadata.
export function FaviconSync() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(media.matches);

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return <link rel="icon" href={dark ? "/icon-dark.svg" : "/icon-light.svg"} />;
}
