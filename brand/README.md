# Brand assets

Icons for the project, used as favicons and account profile pictures.

## The files

Two 1024x1024 PNGs, an `N` set in Satoshi over the palette in `docs/theme.md`:

| File | Background | Mark |
| --- | --- | --- |
| `nextfm-light.png` | champagne-taupe paper (`--background`) | chestnut (`--primary`) |
| `nextfm-dark.png` | chestnut shell (`--background`) | champagne (`--primary`) |

Both sit over a widely spaced perforation field - the champagne metal grille
of the headphones the palette is modeled on. It is pitched more present than
the same texture would be in-app, on purpose: an avatar is shown at ~180px and
smaller, and a perforation that lands under a pixel there gets antialiased into
the background until it disappears. The open pitch, the dot size and the alpha
are all set so the field survives that downscale rather than looking restrained
at full size and turning into nothing where it is actually used.

Both services crop avatars to a circle; the mark is sized to clear the
inscribed circle with margin, so the square and circle crops both work.

## The display-face cut

A second, unshipped pair sets the same `N` in Array - the display face - and
drops the grille:

| File | |
| --- | --- |
| `nextfm-array-light.png`, `nextfm-array-dark.png` | 1024px avatars |
| `icon-array-light.svg`, `icon-array-dark.svg` | the same mark as vector |

Array draws its letters as a field of discrete dots, so the perforation
texture moves out of the background and into the glyph. The grille comes off
because of that, not to simplify: run both and the two dot fields sit at
different pitches over each other and read as noise.

The mark takes a larger cap height here than the Satoshi one (0.58 against
0.54) even though Array is the wider drawing. The dots have to stay separated
after the downscale to display size; set smaller, neighbouring dots antialias
into each other and the strokes go solid, which is the one thing this cut is
for. It still clears the circle crop by 9% of the box.

**Judge this cut at the size it would be used.** It is strongest at 180px and
96px, holds at 48px, and goes muddy at the 16px a browser tab uses - where the
Satoshi mark stays legible. The vectors are kept in this folder rather than
`frontend/public/` for that reason: as an avatar it is the stronger mark, as a
favicon it is not. Promoting it means copying the two SVGs into
`frontend/public/` and pointing `frontend/src/app/favicon-sync.tsx` at them.

## Regenerating

```sh
./generate.sh          # 1024px, both modes
./generate.sh 512      # any edge length
```

`avatar.html` renders one avatar to a canvas, and `generate.sh` screenshots it
in headless Chrome; one run writes all four PNGs. Both faces are vendored here
(`satoshi-variable.woff2`, `array-600.woff2`) as the same files the site
serves, so the marks stay identical if `node_modules` is not built.

`avatar.html` takes `face=satoshi|array` and `grille=on|off` alongside the
existing params, so either cut can be previewed directly in a browser before
regenerating.

The Satoshi `N` is set at `wght 540`, which is *lighter* than the weight body
copy runs at. The site shifts Satoshi's whole ladder up a step to correct its short
x-height (see `docs/theme.md`); a capital has no x-height needing that, so the
mark comes out overweight if it inherits the shift. Judge any change to this
number on the rendered mark, not against the body ladder.

The grille is retunable by query param (`cols` for the pitch, `dot` for the
perforation radius, `alpha` for its opacity) - open `avatar.html` directly to
try values before baking them in. Judge any such change at 180px and 96px: at
full size a field that is far too faint to see in use still looks fine.

The palette is duplicated as literals in `avatar.html` rather than imported
from `globals.css`; if the tokens there change meaningfully, re-derive and
regenerate (same arrangement as the email templates, see `docs/theme.md`).

The site favicon (`frontend/public/icon-{light,dark}.svg`) is the same mark
drawn as vector for tab sizes, not one of these PNGs - it samples its palette
from them and its `N` from `satoshi-variable.woff2`. Re-derive it alongside any
change here: instantiate the variable font at the weight above, take the `N`
outline, and scale it so its cap height is `CAP_RATIO` of the 100-unit viewBox,
centred on both axes.
