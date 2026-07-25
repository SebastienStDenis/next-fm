# Brand assets

Icons for the project, used as favicons and account profile pictures.

## The files

Two 1024x1024 PNGs, an `N` set in Array over the palette in `docs/theme.md`:

| File | Background | Mark |
| --- | --- | --- |
| `nextfm-light.png` | champagne-taupe paper (`--background`) | chestnut (`--primary`) |
| `nextfm-dark.png` | chestnut shell (`--background`) | champagne (`--primary`) |

Array is the display face, and it draws its letters as a field of discrete
dots - the champagne metal grille of the headphones the palette is modeled on,
sitting inside the letterform rather than behind it. Nothing is drawn on the
field behind the mark: a second dot field at a different pitch under this one
reads as noise rather than as texture.

Both services crop avatars to a circle; the mark is sized to clear the
inscribed circle with margin, so the square and circle crops both work.

The site favicon is the same mark drawn as vector - see **Favicon** below.

## Regenerating

```sh
./generate.sh          # 1024px, both modes
./generate.sh 512      # any edge length
```

`avatar.html` renders one avatar to a canvas, and `generate.sh` screenshots it
in headless Chrome. `array-600.woff2` is the same file the site serves,
vendored so the mark stays identical if `node_modules` is not built. Array is
cut at 400 and 600 with nothing between; 600 is the one that carries at the
sizes an avatar is seen at.

The mark takes a large cap height for a display face (`CAP_RATIO`, 0.58 of the
edge). The dots have to stay separated after the downscale to ~180px; set
smaller, neighbouring dots antialias into each other until the strokes go
solid, which loses the only reason to set the mark in this face. Judge any
change to it at 180px and 96px, not at full size, where everything looks fine.

Centre on the glyph's **ink**, not its advance width. Array's `N` carries
sidebearings of 0 and 100, so anything that centres the advance - canvas
`textAlign: "center"` included - hangs the mark a visible step left of the
tile.

The mark is the glyph exactly as Array draws it. Its diagonal meets the right
stem a row above the baseline, leaving the bottom of the stems clear; that is
the typeface's drawing, not a sizing error, and it is deliberately not
corrected by trimming rows or editing the outline.

The palette is duplicated as literals in `avatar.html` rather than imported
from `globals.css`; if the tokens there change meaningfully, re-derive and
regenerate (same arrangement as the email templates, see `docs/theme.md`).

## Favicon

`frontend/public/icon-{light,dark}.svg` is the same mark drawn as vector for
tab sizes, not a scaled PNG - it samples its palette from these files and its
`N` from `array-600.woff2`. Re-derive it alongside any change here: take the
`N` outline and scale it so its cap height is `CAP_RATIO` of the 100-unit
viewBox, centred on both axes.
