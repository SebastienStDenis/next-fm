# Brand assets

Profile pictures for the app-owned bot accounts (Last.fm, Spotify). Not served
by the app - these are uploaded by hand to each service.

## The files

Four 1024x1024 PNGs, an `N` set in Geist over the palette in `docs/theme.md`:

| File | Background | Mark |
| --- | --- | --- |
| `nextfm-plain-light.png` | champagne-taupe paper (`--background`) | chestnut (`--primary`) |
| `nextfm-plain-dark.png` | chestnut shell (`--background`) | champagne (`--primary`) |
| `nextfm-grille-light.png` | as above, plus perforation field | chestnut |
| `nextfm-grille-dark.png` | as above, plus perforation field | champagne |

The `grille` pair carries a faint perforated dot field - the champagne metal
grille of the headphones the palette is modeled on. It reads as texture at
profile size and collapses to a soft tint in small list avatars.

Both services crop avatars to a circle; the mark is sized to clear the
inscribed circle with margin, so the square and circle crops both work.

## Regenerating

```sh
./generate.sh          # 1024px, all four
./generate.sh 512      # any edge length
```

`avatar.html` renders one avatar to a canvas, and `generate.sh` screenshots it
in headless Chrome. `geist-latin.woff2` is the same Geist subset the site
serves, vendored so the mark stays identical if `node_modules` is not built.

The palette is duplicated as literals in `avatar.html` rather than imported
from `globals.css`; if the tokens there change meaningfully, re-derive and
regenerate (same arrangement as the email templates, see `docs/theme.md`).
