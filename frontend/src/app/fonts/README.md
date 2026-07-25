# Fonts

`array-400.woff2`, `array-600.woff2` - Array by Indian Type Foundry, downloaded
from https://www.fontshare.com/fonts/array and used under the ITF Free Font
License. Self-hosted rather than loaded from the Fontshare CDN so the app keeps
making no third-party font requests; `next/font/local` in `../layout.tsx`
declares the faces.

Array has no variable axis, so each weight is a separate file. Only the two the
headings set are here; 700 also exists upstream if a heavier title is ever
wanted.
