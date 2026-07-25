# Fonts

Both faces are by Indian Type Foundry, downloaded from Fontshare and used under
the ITF Free Font License. They are self-hosted rather than loaded from the
Fontshare CDN so the app makes no third-party font requests; `next/font/local`
in `index.ts` declares them, which is what lets the root layout and the
standalone `global-error.tsx` document set the same faces.

- `satoshi-variable.woff2`, `satoshi-variable-italic.woff2` - Satoshi, the body
  face (https://www.fontshare.com/fonts/satoshi). Variable across `wght`
  300-900, so every weight the UI asks for is drawn rather than synthesized,
  and the italic is a true italic rather than a slanted upright.
- `array-400.woff2`, `array-600.woff2` - Array, the display face
  (https://www.fontshare.com/fonts/array). No variable axis, so each weight is
  a separate file; only the two the headings set are here, and 700 exists
  upstream if a heavier title is ever wanted.
