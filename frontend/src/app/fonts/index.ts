import localFont from "next/font/local";

// Both faces are Fontshare, so both are self-hosted. Satoshi carries a real
// italic, which the asides and `q` in globals.css lean on; without it the
// browser would slant the upright instead.
export const satoshi = localFont({
  src: [
    {
      path: "./satoshi-variable.woff2",
      weight: "300 900",
      style: "normal",
    },
    {
      path: "./satoshi-variable-italic.woff2",
      weight: "300 900",
      style: "italic",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

// Array (Fontshare) is self-hosted rather than loaded from next/font/google
// because it is not a Google font. It has no variable axis, so each weight is
// its own file; only the two the headings actually set are shipped.
export const array = localFont({
  src: [
    { path: "./array-400.woff2", weight: "400", style: "normal" },
    { path: "./array-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  // Array draws its caps 14% shorter than Satoshi at the same font-size, so an
  // unadjusted heading reads a size small. size-adjust scales the glyphs
  // instead of the type scale, which keeps text-2xl meaning text-2xl and lets
  // every use inherit the correction. The two faces disagree about the
  // x-height-to-cap ratio and no single number satisfies both; caps win,
  // because that is what carries a heading.
  declarations: [{ prop: "size-adjust", value: "115%" }],
});

// The pairing the app runs on. `global-error.tsx` takes `satoshi.variable`
// alone: it renders its own document, and the body face is the only one it
// sets - with `--font-display` unset there, `--font-heading` falls back to the
// body face rather than to nothing.
export const fontVariables = [satoshi.variable, array.variable];
