"use client";

import { useEffect, useState } from "react";

/**
 * TEMPORARY - a bar for comparing candidate body faces in place. Swaps
 * `--font-sans` on the document, so it moves every surface the display face
 * does not own. Delete this file, its mount in `layout.tsx`, and the alternate
 * fonts declared there once a face is chosen.
 */

// The ladder the app's `font-*` classes are written against.
const BASE_RAMP = { normal: 400, medium: 500, semibold: 600, bold: 700 };

// Satoshi is the one the app ships; the rest are here to be compared against
// it. Each face carries the corrections it needs to be judged fairly, since
// showing them all raw would mostly show whose defaults happen to suit this
// UI.
//
// `weightOffset` shifts the whole ladder: faces differ in how much ink they
// lay down at a nominal weight, so matching the numbers would not match the
// colour. An offset is only free on a variable face, where `wght` is a
// continuous axis - Be Vietnam Pro is a set of static cuts, so it can only be
// asked for weights it actually ships, which is why it sits at 0.
//
// `tracking` corrects sidebearings this UI does not want: Be Vietnam Pro is
// spaced for stacked Vietnamese diacritics, which reads loose in English.
const FACES = [
  {
    id: "satoshi",
    label: "Satoshi",
    varName: "--font-sans",
    weightOffset: 100,
    tracking: "normal",
    axis: "variable, wght 300-900",
  },
  {
    id: "geist",
    label: "Geist",
    varName: "--font-alt-geist",
    weightOffset: 0,
    tracking: "normal",
    axis: "variable, wght 100-900",
  },
  {
    id: "general-sans",
    label: "General Sans",
    varName: "--font-alt-general-sans",
    weightOffset: 50,
    tracking: "normal",
    // wght tops out at 700, so the `bold` step clamps there. Nothing in the
    // app sets font-bold, so the ladder is unaffected in practice.
    axis: "variable, wght 200-700",
  },
  {
    id: "be-vietnam",
    label: "Be Vietnam",
    varName: "--font-alt-be-vietnam",
    weightOffset: 0,
    tracking: "-0.025em",
    axis: "static cuts 400-800",
  },
] as const;

type FaceId = (typeof FACES)[number]["id"];

function apply(faceId: FaceId) {
  const face = FACES.find((f) => f.id === faceId) ?? FACES[0];
  const root = document.documentElement;
  // Satoshi already owns --font-sans, so pointing it at itself would recurse.
  if (face.varName === "--font-sans") {
    root.style.removeProperty("--font-sans");
  } else {
    root.style.setProperty("--font-sans", `var(${face.varName})`);
  }
  for (const [step, value] of Object.entries(BASE_RAMP)) {
    root.style.setProperty(
      `--font-weight-${step}`,
      String(value + face.weightOffset),
    );
  }
  // Inherited, so it reaches the display face too on the few titles that set
  // no tracking of their own. Left that way on purpose: scoping it would cost
  // more machinery than this throwaway bar is worth.
  root.style.letterSpacing = face.tracking;
}

export function FontPicker() {
  const [face, setFace] = useState<FaceId>("satoshi");

  // Not persisted: the root layout survives client-side navigation, so a
  // choice holds while moving around the app and resets on a hard reload.
  useEffect(() => {
    apply(face);
  }, [face]);

  const active = FACES.find((f) => f.id === face)!;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-1.5 border-b border-border bg-card/95 px-3 py-2 text-xs backdrop-blur">
      <span className="mr-1 font-sans text-muted-foreground">Body face</span>
      {FACES.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => setFace(f.id)}
          style={{ fontFamily: `var(${f.varName})` }}
          title={`${f.label} - ${f.axis}, weight ${f.weightOffset > 0 ? `+${f.weightOffset}` : "base"}`}
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
      <span className="font-sans text-muted-foreground">
        weight{" "}
        {active.weightOffset > 0 ? `+${active.weightOffset}` : "base"}
        {" · "}
        {BASE_RAMP.normal + active.weightOffset}/
        {BASE_RAMP.medium + active.weightOffset}/
        {BASE_RAMP.semibold + active.weightOffset}
      </span>
    </div>
  );
}
