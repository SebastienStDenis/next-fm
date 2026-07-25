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

## Regenerating

```sh
./generate.sh          # 1024px, both modes
./generate.sh 512      # any edge length
```

`avatar.html` renders one avatar to a canvas, and `generate.sh` screenshots it
in headless Chrome. `satoshi-variable.woff2` is the same file the site serves,
vendored so the mark stays identical if `node_modules` is not built.

The `N` is set at `wght 540`, which is *lighter* than the weight body copy
runs at. The site shifts Satoshi's whole ladder up a step to correct its short
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
