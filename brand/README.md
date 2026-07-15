# Brand assets

Profile pictures for the app-owned bot accounts (Last.fm, Spotify). Not served
by the app - these are uploaded by hand to each service.

## The files

Two 1024x1024 PNGs, an `N` set in Geist over the palette in `docs/theme.md`:

| File | Background | Mark |
| --- | --- | --- |
| `nextfm-light.png` | champagne-taupe paper (`--background`) | chestnut (`--primary`) |
| `nextfm-dark.png` | chestnut shell (`--background`) | champagne (`--primary`) |

Both sit over a faint, widely spaced perforation field - the champagne metal
grille of the headphones the palette is modeled on. The open pitch is what
carries it into small list avatars; a fine field washes out to a flat tint
there, leaving the mark to carry the whole avatar on its own.

Both services crop avatars to a circle; the mark is sized to clear the
inscribed circle with margin, so the square and circle crops both work.

## Regenerating

```sh
./generate.sh          # 1024px, both modes
./generate.sh 512      # any edge length
```

`avatar.html` renders one avatar to a canvas, and `generate.sh` screenshots it
in headless Chrome. `geist-latin.woff2` is the same Geist subset the site
serves, vendored so the mark stays identical if `node_modules` is not built.

The grille is retunable by query param (`cols` for the pitch, `dot` for the
perforation radius) - open `avatar.html` directly to try values before baking
them in.

The palette is duplicated as literals in `avatar.html` rather than imported
from `globals.css`; if the tokens there change meaningfully, re-derive and
regenerate (same arrangement as the email templates, see `docs/theme.md`).
