# Wording conventions

*Written 2026-07-11 by Claude (Fable 5).*

User-facing copy (web UI, sync step labels and summaries, emails) uses one
vocabulary. When adding or editing copy, follow these rules; when the product
changes, update this doc in the same change. Introduced by
`docs/design/2026-07-09-standardize-missing-data-messages.md`.

## Product name

The product is written **NextFM** everywhere: UI, documentation, emails,
API titles. Never "Next.fm". Third-party brands keep their own styling
(Last.fm, Spotify, Bandsintown).

Copy refers to the product in the third person ("NextFM finds...",
"NextFM will add..."), never in the first person ("we", "we'll").

## Terms

| Use | Not |
| --- | --- |
| listening history | taste, scrobbles |
| suggested artists | recommendations, similar artists |
| concerts | events, shows |
| playlists | - |
| tracks | songs |
| home city / pinned cities | city (when the home one is meant) |

## Verbs

Each noun pairs with one verb; keep the pair everywhere, including sync step
labels and summaries.

- Listening history is **imported** / **importing**.
- Artists are **suggested** / **suggesting**. With the verb, say "artists",
  not "suggested artists" ("suggesting suggested artists" is redundant).
- Concerts are **found** / **finding**.
- Playlists are **generated** / **generating**.
- Artists are **hidden** / **unhidden** (never ignored, excluded, muted or
  blocked; "exclusion" is the stored policy's name, per
  `docs/design/2026-07-07-ignoring-plan.md`, not user-facing copy).

The one-line pitch for a sync chains all four: "Imports listening history,
suggests artists, finds concerts and generates playlists."

## Empty states

Every list fed by a sync distinguishes "no successful sync step yet" from "the
step ran and found nothing". The step statuses come from `GET /me/sync`
(`artists`, `suggestions`, `events`, `playlists`). Existing data always
renders regardless of sync status (which is best-effort and forgets runs that
age out of Temporal retention); these messages only decide what an empty list
says.

| Place | Step not completed | Step completed, list empty |
| --- | --- | --- |
| Listening History (account) | Run a sync above to import listening history. | No listening history imported. If you just signed up for Last.fm, wait for Last.fm to capture future listening history. |
| Artists tab | Run a sync in [Account] to suggest artists. | No artists suggested. If you just signed up for Last.fm, wait for Last.fm to capture future listening history. |
| Concerts tab | Run a sync in [Account] to find concerts. | Home view: "No concerts found near {city}." Browsing another city: "No concerts found. Try a different city." |
| Playlists tab | Run a sync in [Account] to generate playlists. | No playlists generated. Set your home city in [Account]. |

`[Account]` links to the account page. Two related fixed messages:

- Concerts tab with no home city set (regardless of sync state): "Set your
  home city in [Account] to see local concerts."
- An empty tracklist inside a playlist: "No tracks found. NextFM will add new
  ones as your listening history and upcoming concerts change."

## Section and tab names

- Dashboard tabs: **Artists**, **Concerts**, **Playlists** (each label carries
  a live count, e.g. "Artists (12)").
- Account sections: **Daily Sync**, **Last.fm**, **Home City**,
  **Pinned Cities**, **Options**, **Listening History**.

## Canonical sentences

Keep these exactly as written:

- Tagline: "Live-music discovery through listening."
- Intro: "NextFM finds upcoming concerts near you by artists that match your
  listening history, and generates Spotify playlists for you to discover
  them. Playlists update daily."
- Daily Sync section: "Imports listening history, suggests artists, finds
  concerts and generates playlists."
- Artists tab: "Artists you might like based on your listening history."
- Concerts tab: "Upcoming concerts near you by suggested artists."
- Playlists tab: "Spotify playlists tracking suggested concerts in your
  cities."
- About page, playlist section: "Tracklists are automatically updated every
  day as your listening history and upcoming concerts change."
- Listening History section: "Your listening history is used to suggest
  artists and find concerts. Hidden artists are skipped."
- Confirmation email: "... and start discovering live music through
  listening."
