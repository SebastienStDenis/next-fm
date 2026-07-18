# Theme

*Written 2026-07-11 by Claude (Fable 5).*

The site's visual identity. When adjusting styling, follow these guidelines;
when the theme changes, update this doc in the same change.

## Inspiration

The palette is modeled on the **Focal Bathys MG** headphones colorway: a deep
chestnut brown shell paired with a desaturated magnesium/champagne metal
grille. The two modes are the two sides of that material pairing:

- **Light mode** is the magnesium side - champagne-taupe paper, warm-grey
  surfaces, with the deep chestnut as the action color (buttons, active tab).
- **Dark mode** is the chestnut shell - warm brown surfaces with the
  champagne metal as the action color.

The general vibe: matte metal and wood rather than stage lights and neon.
Warm, muted, a little hi-fi. Every hue in the system sits between 45° and 75°
in oklch (brown → champagne); nothing is allowed to drift yellow, orange, or
red enough to read as a "colorful accent" - the accent is a material, not a
color.

## How it's built

Everything lives in the shadcn/ui token set in `frontend/src/app/globals.css`
(`:root` for light, `.dark` for dark), expressed in oklch. Guidelines that
shaped the values, and should shape future adjustments:

- **Low chroma everywhere.** Neutrals carry 0.004-0.03 chroma; even the
  primary stays under 0.075. If a tweak makes something look "poppy", it has
  drifted off-theme.
- **Warmth lives in surfaces and text, not in lines.** Borders and input
  edges are the greyest tokens in the system (chroma ~0.013 in light mode),
  so hairlines read crisp rather than rosy. Dark-mode borders are translucent
  champagne - 17% over cards, 22% on inputs - enough to define a card edge
  and make a field read as a field without breaking the tight layer
  hierarchy.
- **Dark mode avoids pure white.** Foreground text is warm ivory
  (L 0.86), captions L ~0.72 - readable (>= 6:1 on cards) without OLED glare.
- **Layer hierarchy in dark mode** is deliberately tight: background L 0.17,
  cards 0.215, pills/badges ~0.31, active-tab champagne 0.76. Separation
  comes from these small steps plus borders, not from brightness jumps.
- **Text selection** is themed (champagne highlight, chestnut text) as a
  small flourish.

## Typography

- **Explanatory asides are small italics.** Text that annotates a heading or
  section (the intro paragraph, dashboard tab descriptions, settings section
  descriptions, listener counts) renders `text-xs text-muted-foreground
  italic`, so it reads as a quiet aside rather than body copy.
- **Quoted phrases use `<q>`.** Genuine quotations in prose (e.g. the sample
  suggestion reason on the about page) are marked up with the `q` element; the
  base layer in `globals.css` supplies curly quote marks and italics.
- **UI label names are medium-weight, not quoted.** When prose refers to a
  control by name (Spotify's "Date added" sort), set it in
  `<b className="font-medium">` - no quote marks. Full bold would shout;
  medium matches the section headings.
- **Empty-state messages are small and quiet.** Missing-data messages render
  `text-xs leading-5 text-muted-foreground`, centered - in the dashed ghost
  box on the dashboard (one card wide, in the results grid), as plain text in
  panels that are already cards. The `leading-5` line height matches the
  `h-5` inline-nav pill, so an inline Settings button sits flush in the line
  instead of pushing it apart.

## Wrapping on narrow screens

Rows degrade in one of a few deliberate ways when width runs out. Pick the
pattern by what the row holds, and never let a long third-party string
(artist, venue, city, playlist, tag names) force horizontal overflow.

- **Text wraps; controls hold.** In a row of text plus a control or badge
  (taste rows, pinned cities, the city card, artist title rows and their
  score badge), the text region takes `min-w-0` and wraps onto extra lines
  while the control is `shrink-0` and keeps its spot on the right. Where the
  text can wrap tall, the control pins to the first line so it tracks the
  name (artist title rows in cards and popovers, the listening-history hide
  control); compact rows keep it centered (pinned cities, the city card).
  The global `overflow-wrap: break-word` in `globals.css` only kicks in once
  the flex item may shrink, so any flex child rendering external strings
  carries `min-w-0`.
- **Right-aligned metadata stays right-aligned when it wraps.** Dates,
  synced stamps, and Tickets links are pushed right with `ml-auto` on the
  item, not `justify-between` on the row, so that when one wraps onto its
  own line it holds the right edge instead of snapping left under the text.
- **Groups of equal items wrap as items.** Badge, tag, and filter-toggle
  groups are `flex flex-wrap`; whole items drop to the next line rather than
  wrapping internally.
- **Truncation is the exception.** Browsing surfaces let names wrap and grow
  taller; ellipsis truncation is reserved for dense fixed-shape contexts -
  dropdown result rows (city search), the one-line sync step summary,
  settings key-value rows (name, email), and badge internals (artist chips,
  tags), since a badge never wraps internally.
- **Leading markers pin to the first line.** Decorative dots and pointer
  marks beside wrappable text align to the first text line (the playlist
  card's pulse dot, the save-tip arrow), so they read as bullets rather than
  floating beside the block.
- The page floor is 320px (`min-w-80` in `layout.tsx`); below that the page
  pans horizontally rather than squeezing further. Dialogs share the floor:
  dialog and alert-dialog panels carry `min-w-[18rem]` (a dialog's width at
  a 320px viewport), so overlays stop shrinking where the page does. The
  panel centers inside a full-viewport scroll layer rather than being fixed
  itself, so below the floor the dialog pans horizontally like the page
  instead of clipping at the viewport edge.

## Interactive affordances

- **Internal navigation is a button, never an underlined link.** In-app
  references - both chrome (the Settings and Home buttons) and inline mentions
  in prose ("Run a sync in Settings…", "See About…") - render as buttons;
  prose uses the small outline pill in `frontend/src/app/inline-nav.tsx`.
  Page navigation carries a trailing directional arrow. The settings dialog
  opens in place, so its triggers (hash links to `#settings`) swap the arrow
  for a leading gear icon - the dashboard header button and inline pills
  alike. Underlined text links are reserved for external targets (Spotify,
  Last.fm, event pages), which also carry the external-link icon where space
  allows.
- **Hover feedback is a background highlight, not a text-color change.**
  Interactive text (ghost/outline buttons, clickable lines like the
  get-started nudge) hovers with the muted background wash the button
  variants provide; a color-only hover on bare text is off-theme.

## Scrollbars

Every scrollbar - the page scroll, the settings dialog, overflowing panels
like My Artists - is the same minimal bar: a 6px rounded thumb in `--border`
on a transparent track, styled once globally in `globals.css` (webkit
pseudo-elements, with `scrollbar-width: thin` scoped to Firefox). Don't style
scrollbars per-element; if a container should hide its bar entirely (e.g. the
command palette), use the `no-scrollbar` utility.

## Where the accent shows

The primary token is deliberately present on every logged-in page: the active
dashboard tab is a solid primary pill (chestnut in light, champagne in dark),
the sliding tab indicator carries it between tabs, and primary buttons and
focus rings use the same token. Badges, hovers, and muted text use the tinted
neutral tokens, so the whole page reads warm without competing accents.

## Status colors

Status signals are the one deliberate exception to the "accent is a material,
not a color" rule. `--destructive` (red), `--success` (green), and `--warning`
(amber) live alongside the neutral tokens in `globals.css` and *do* read as
color, because a status has to be recognizable at a glance. They are kept as
muted as they can be while staying unmistakably red/green/amber - chroma sits
around 0.11-0.17, well below a stock Tailwind `red-500`/`green-600` but above
the point where red drifts to brown and green to olive-grey. Nudging them
lower reads as "broken/greyed", not "on-theme"; that floor is intentional.

- `--destructive` doubles as the shadcn error token, so retuning it recolors
  every red at once: destructive buttons/badges, `aria-invalid` field borders
  and rings, the attention dot, and the red `X` marks in forms and sync steps.
- `--success` replaced the previously hardcoded `text-green-600
  dark:text-green-500`; the green check marks (sync steps, password/reset
  requirements met) all use `text-success` now, so the token is the single
  place to tune them.
- Toast icons follow the same simple `Check` / `X` vocabulary used inline,
  colored by these tokens: success = check (`--success`), error = x
  (`--destructive`), warning = triangle (`--warning`). Info toasts show **no
  icon at all** - info carries no state to react to, so the icon would be pure
  decoration; its absence is what distinguishes an FYI from a message that
  wants a reaction (see `frontend/src/components/ui/sonner.tsx`).

## Email

Auth emails (`supabase/templates/*.html`) can't use the `oklch()` tokens
above - mail clients need plain hex - so they carry a converted hex snapshot
of the same palette (card/foreground/primary/muted/border, light and dark)
instead of importing `globals.css`. The outer background around the card is
the exception: it is left transparent so the mail client's own canvas shows
through and the frame matches the client exactly in both modes; the card's
border keeps it defined when the canvas matches the card.
The dark border token is
translucent; its hex is the value composited over the dark card. Dark mode is
a `prefers-color-scheme: dark` media query overriding classed elements,
guarded by a `color-scheme` meta tag; light-mode inline styles are the
fallback for clients that ignore both. If the token values in `globals.css`
change meaningfully, re-derive the hex snapshot here too.

## Avatars

The bot accounts' profile pictures (`brand/`) are an `N` in Geist on
`--background`, marked in `--primary` - chestnut on paper in light, champagne
on shell in dark. Both sit over a widely spaced perforation field: the
"magnesium grille" half of the palette, made literal. That field is pitched
more present than the low-contrast guidance above would suggest, which is
deliberate - avatars are shown at ~180px and smaller, and a texture tuned to
in-app restraint antialiases away to nothing at that size. Like the email
templates they carry their own copy of the palette rather than importing
`globals.css` (they render outside the app), so a meaningful token change means
regenerating them: see `brand/README.md`.

## Favicon

`frontend/public/icon-{light,dark}.svg` is the same mark at tab size, and
carries the same palette copy again - the browser rasterizes it outside the
app, so it can't reach the tokens either. It is vector rather than a scaled
avatar: a favicon is seen at 16-32px, where the grille has already antialiased
away to a faint tint and only the `N` still reads.

The tile is rounded at 20% of its edge - the usual app-icon proportion, and far
looser than `--radius` would give if scaled down to this size, which would read
as square. The avatars stay square because both services crop them to a circle
anyway. The radius lives on a clip path rather than on each rect, so the grille
cannot spill past the corners.

The two files are identical but for the two fills, and neither carries a
`prefers-color-scheme` query: `frontend/src/app/favicon-sync.tsx` picks between
them instead. Swapping the `href` is the only mechanism that tracks the scheme
live in every engine - Chrome rasterizes an SVG favicon once and won't
re-evaluate a query baked into it until reload, Safari never evaluates one, and
Firefox has ignored a `media` attribute on the `<link>` since 2019. The cost is
that the icon needs JS: the served default is the light variant, so a dark-mode
tab shows it briefly before hydration. Deriving the mark by hand would drift
from `brand/avatar.html`, so the palette is sampled from the rendered avatars
and the path is Geist `N` at wght 560 pulled from `brand/geist-latin.woff2`;
re-derive from there if either changes.
