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

- **Low chroma everywhere.** Neutrals carry 0.005-0.03 chroma; even the
  primary stays under 0.075. If a tweak makes something look "poppy", it has
  drifted off-theme.
- **Dark mode avoids pure white.** Foreground text is warm ivory
  (L 0.86), captions L ~0.72 - readable (>= 6:1 on cards) without OLED glare.
- **Layer hierarchy in dark mode** is deliberately tight: background L 0.17,
  cards 0.215, pills/badges ~0.31, active-tab champagne 0.76. Separation
  comes from these small steps plus borders, not from brightness jumps.
- **Text selection** is themed (champagne highlight, chestnut text) as a
  small flourish.

## Typography

- **Explanatory asides are small italics.** Text that annotates a heading or
  section (the intro paragraph, dashboard tab descriptions, account section
  descriptions, listener counts) renders `text-xs text-muted-foreground
  italic`, so it reads as a quiet aside rather than body copy.
- **Empty-state messages are small and quiet.** Missing-data messages render
  `text-xs leading-5 text-muted-foreground`, centered - in the dashed ghost
  box on the dashboard (one card wide, in the results grid), as plain text in
  panels that are already cards. The `leading-5` line height matches the
  `h-5` inline-nav pill, so an inline Account button sits flush in the line
  instead of pushing it apart.

## Interactive affordances

- **Internal navigation is a button, never an underlined link.** In-app page
  references - both chrome (the Account and Home buttons) and inline mentions
  in prose ("Run a sync in Account…", "See About…") - render as buttons with
  a directional arrow; prose uses the small outline pill in
  `frontend/src/app/inline-nav.tsx`. Underlined text links are reserved for
  external targets (Spotify, Last.fm, event pages), which also carry the
  external-link icon where space allows.
- **Hover feedback is a background highlight, not a text-color change.**
  Interactive text (ghost/outline buttons, clickable lines like the
  get-started nudge) hovers with the muted background wash the button
  variants provide; a color-only hover on bare text is off-theme.

## Where the accent shows

The primary token is deliberately present on every logged-in page: the active
dashboard tab is a solid primary pill (chestnut in light, champagne in dark),
the sliding tab indicator carries it between tabs, and primary buttons and
focus rings use the same token. Badges, hovers, and muted text use the tinted
neutral tokens, so the whole page reads warm without competing accents.
