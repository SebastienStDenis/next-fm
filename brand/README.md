# Brand assets

Profile pictures for the app-owned bot accounts (Last.fm, Spotify). Not served
by the app - these are uploaded by hand to each service.

## The files

Four 1024x1024 PNGs, an `N` set in Geist over the palette in `docs/theme.md`.
Light is chestnut on champagne-taupe paper, dark is champagne on chestnut
shell; both sit over a faint perforated grille - the champagne metal grille of
the headphones the palette is modeled on.

| File | Field |
| --- | --- |
| `nextfm-grille-light.png` | grille at rest |
| `nextfm-grille-dark.png` | grille at rest |
| `nextfm-wave-light.png` | grille mid-wave |
| `nextfm-wave-dark.png` | grille mid-wave |

The `wave` pair catches a wavefront crossing the grille, the same displacement
the landing-page field animates: it enters upper left, passes behind the mark,
and re-emerges lower right, leaving the origin corner settled. Both pairs read
as texture at profile size and collapse to a soft tint in small list avatars,
where the mark carries on its own.

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

The wave geometry is overridable by query param (`ox`, `oy`, `r`, `sigma`,
`amp`, `boost`) - open `avatar.html` directly to reframe it. Two constraints
worth keeping: a centred origin rings the mark like a target, and `sigma` has
to stay well clear of the grid pitch or the front aliases into scatter.

The palette is duplicated as literals in `avatar.html` rather than imported
from `globals.css`; if the tokens there change meaningfully, re-derive and
regenerate (same arrangement as the email templates, see `docs/theme.md`).
