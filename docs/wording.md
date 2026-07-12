# Wording conventions

*Written 2026-07-11 by Claude (Fable 5).*

User-facing copy (web UI, sync step labels and summaries, emails) uses one
vocabulary. When adding or editing copy, follow these rules; when the product
changes, update this doc in the same change. Introduced by
`docs/design/2026-07-09-standardize-missing-data-messages.md`; empty states
and freshness markers revised by
`docs/design/2026-07-11-standardize-missing-data-messages-version-2.md`.

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

Data always shows when any exists - never hide it for being stale. Only when
a list fed by a sync is empty does it distinguish "no successful sync step
yet" from "the step ran and found nothing". The step statuses come from
`GET /me/sync` (`artists`, `suggestions`, `events`, `playlists`), which
reports the latest run only.

"Found nothing" messages follow the format: "No \<result\> \<actioned\>.
\<Optional guidance per scenario\>. \<Note that new data will appear as
things change\>."

Dashboard ghost boxes are one card wide, placed in the same grid the result
cards would use; Listening History and tracklist messages are plain text.

| Place | Step not completed | Step completed, list empty |
| --- | --- | --- |
| Listening History (settings) | Run a sync above to import listening history. | No listening history imported. If you just signed up for Last.fm, wait for Last.fm to capture future listening history. NextFM will import new listening history as it appears. |
| Artists tab | Run a sync in [Settings] to suggest artists. | No artists suggested. If you just signed up for Last.fm, wait for Last.fm to capture future listening history. NextFM will suggest new artists as your listening history changes. |
| Concerts tab | Run a sync in [Settings] to find concerts. | Home view: "No concerts found near {city}. NextFM will find new concerts as they're announced." Browsing another city: "No concerts found. Try a different city." |
| Playlists tab | Run a sync in [Settings] to generate playlists. | No playlists generated. Set your home city in [Settings]. (No new-data note - nothing flows in without a home city.) |

`[Settings]` opens the settings dialog (`/dashboard#settings`). Three related
fixed messages:

- Concerts tab with no home city set (regardless of sync state): "Set your
  home city in [Settings] to see local concerts."
- Concerts hidden by the filter toggles: a card-sized ghost box in the
  concerts grid, after any visible concerts: "{n} concert(s) hidden by
  filters."
- An empty tracklist inside a playlist: "No tracks found. NextFM will add new
  ones as your listening history and upcoming concerts change."

## Freshness markers

The Artists, Concerts, and Playlists tabs show a green check with the time
their step last succeeded, right-aligned on the tab's description line. The
label is the step's action, a middle dot, then the date - "Suggest artists ·
{date}", "Find concerts · {date}", "Generate playlists · {date}" - never a
result claim like "Artists suggested", which reads oddly next to an empty
list. Nothing is shown when the latest run has not completed the step. Each
playlist card also shows its own last write beside its track count as plain
text - "Synced {date}", no check, since it isn't a sync-step marker.
Listening History relies on the Daily Sync card above it.

## Section and tab names

- Dashboard tabs: **Artists**, **Concerts**, **Playlists** (each label carries
  a live count, e.g. "Artists (12)").
- Settings sections: **Daily Sync**, **Last.fm**, **Home City**,
  **Pinned Cities**, **Options**, **Listening History**, **Account**.

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
