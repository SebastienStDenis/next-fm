"use client";

import { useEffect, useState } from "react";

/**
 * TEMPORARY - a bar for comparing candidate body faces in place. Swaps
 * `--font-sans` on the document, so it moves every surface the display face
 * does not own. Delete this file, its mount in `layout.tsx`, and the alternate
 * fonts declared there once a face is chosen.
 */

// Satoshi is the one the app ships; the rest are here to be compared against
// it. Each face carries the corrections it needs to be judged fairly, since
// showing them all raw would mostly show whose defaults happen to suit this
// UI. `ramp` is the weight ladder: Satoshi lays down ~20% less ink than Geist,
// so it is set a step up. `tracking` is set where a face is drawn with
// sidebearings this UI does not want - Be Vietnam Pro is spaced for stacked
// Vietnamese diacritics, which reads loose in English at these sizes.
const FACES = [
  {
    id: "satoshi",
    label: "Satoshi",
    varName: "--font-sans",
    ramp: "up",
    tracking: "normal",
  },
  {
    id: "geist",
    label: "Geist",
    varName: "--font-alt-geist",
    ramp: "base",
    tracking: "normal",
  },
  {
    id: "general-sans",
    label: "General Sans",
    varName: "--font-alt-general-sans",
    ramp: "up",
    tracking: "normal",
  },
  {
    id: "be-vietnam",
    label: "Be Vietnam",
    varName: "--font-alt-be-vietnam",
    ramp: "base",
    tracking: "-0.025em",
  },
] as const;

const RAMPS = {
  base: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  up: { normal: 500, medium: 600, semibold: 700, bold: 800 },
} as const;

type FaceId = (typeof FACES)[number]["id"];
type RampId = keyof typeof RAMPS;

function apply(faceId: FaceId, rampOverride: RampId | null) {
  const face = FACES.find((f) => f.id === faceId) ?? FACES[0];
  const root = document.documentElement;
  // Satoshi already owns --font-sans, so pointing it at itself would recurse.
  if (face.varName === "--font-sans") {
    root.style.removeProperty("--font-sans");
  } else {
    root.style.setProperty("--font-sans", `var(${face.varName})`);
  }
  const ramp = RAMPS[rampOverride ?? face.ramp];
  for (const [step, value] of Object.entries(ramp)) {
    root.style.setProperty(`--font-weight-${step}`, String(value));
  }
  // Inherited, so it reaches the display face too on the few titles that set
  // no tracking of their own. Left that way on purpose: scoping it would cost
  // more machinery than this throwaway bar is worth.
  root.style.letterSpacing = face.tracking;
}

export function FontPicker() {
  const [face, setFace] = useState<FaceId>("satoshi");
  const [ramp, setRamp] = useState<RampId | null>(null);

  // Not persisted: the root layout survives client-side navigation, so a
  // choice holds while moving around the app and resets on a hard reload.
  useEffect(() => {
    apply(face, ramp);
  }, [face, ramp]);

  const activeRamp = ramp ?? FACES.find((f) => f.id === face)!.ramp;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-1.5 border-b border-border bg-card/95 px-3 py-2 text-xs backdrop-blur">
      <span className="mr-1 font-sans text-muted-foreground">Body face</span>
      {FACES.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => setFace(f.id)}
          style={{ fontFamily: `var(${f.varName})` }}
          className={
            "rounded-md border px-2 py-1 transition-colors " +
            (f.id === face
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:bg-muted")
          }
        >
          {f.label}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        onClick={() => setRamp(activeRamp === "up" ? "base" : "up")}
        title="Each face has a default ladder; this forces both so you can see the same face at either weight."
        className="rounded-md border border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-muted"
      >
        weight: {activeRamp === "up" ? "+100" : "base"}
      </button>
    </div>
  );
}
