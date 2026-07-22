# Wording conventions

*Written 2026-07-11 by Claude (Fable 5); revised 2026-07-22 by Claude (Fable 5).*

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

## Sync step summaries

The line under each step in the Daily Sync card names only outcomes the user
can see in the product, never pipeline internals (seeds, candidates, scoring,
cache freshness, interest rows, enrichment). Each summary opens with the
step's past-tense verb and separates clauses with " · ":

- Import listening history: "Imported {n} artists · {m} new" ({n} counts
  every artist in the listening history, {m} the ones first seen this run)
- Suggest artists: "Suggested {n} artists · {m} new" ({n} counts every
  currently suggested artist, {m} the ones new this run)
- Find concerts: "Found {n} new concerts"
- Generate playlists: "Generated {n} playlists · {a} tracks added,
  {r} removed" (track counts span all playlists, including ones emptied
  because a city was unpinned)

Failed steps show the activity's own user-phrased error message instead
(`app.sync.sync_activities._user_facing_errors`).

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
| Playlists tab | Run a sync in [Settings] to generate playlists. | No playlists generated. NextFM will generate them on the next daily sync. |

`[Settings]` opens the settings dialog (`/dashboard#settings`). Three related
fixed messages:

- Artists or concerts hidden by the filter toggles ("Suggested artists" /
  "Artists you listen to", on both tabs): a card-sized ghost box in the tab's
  grid, after any visible cards: "{n} artist(s)/concert(s) hidden by
  filters."
- The Artists tab's messages describe its suggestions, so they fill the tab
  only when there are also no artists you listen to; otherwise the message is
  a card-sized cell in the grid, kept while the Suggested artists filter is
  on.
- An empty tracklist inside a playlist: "No tracks found. NextFM will add new
  ones as your listening history and upcoming concerts change."

There is no "no home city" or "unlinked Last.fm" state: the dashboard
requires a linked Last.fm account, a home city and a successful sync (see
Welcome flow), and both the account and the city can be changed but never
cleared.

## Freshness markers

The Artists, Concerts, and Playlists tabs show the latest run's outcome for
their step, right-aligned on the tab's description line. The text is always
the step's action, a middle dot, then the date - "Suggest artists · {date}",
"Find concerts · {date}", "Generate playlists · {date}" - never a result
claim like "Artists suggested", which reads oddly next to an empty list, and
never error text. The mark alone carries the outcome: a green check when the
step succeeded (the date is when it succeeded), a red x when the run failed
(the date is when it failed) - shown on every tab whose step didn't complete,
since an earlier step failing stops the later ones - or a spinner, with no
date, while a run is in flight. The marker links to the settings dialog,
whose Daily Sync card carries the failure detail; a failed marker says "Last
sync failed" in its tooltip. Nothing is shown when no run is on record. Each
playlist card also shows its own last write beside its track count as plain
text - "Synced {date}", no check, since it isn't a sync-step marker.
Listening History relies on the Daily Sync card above it.

## Daily Sync card notices

While a run is in flight, the Daily Sync card can add one muted line under
the status row:

- Run in flight longer than usual: "Taking longer than usual. Feel free to
  close the page, the sync will continue." Shown only while progress polling
  succeeds; it promises continuation, never success.
- Progress polling failing repeatedly: "Can't check sync progress right now.
  Retrying." Takes the line's place - when progress is unreachable, the card
  must not claim the sync is still running.

## Welcome flow

The dashboard requires a linked Last.fm account, a home city and a
successful sync; anyone short of that is redirected to `/welcome`, a guided,
non-skippable page that reuses the settings cards unchanged - **Last.fm**,
**Home City**, then **Daily Sync**, named for the cadence even on the first
run (the manual run just starts what then repeats). A pulsing attention dot
on the section heading marks the next step and completed steps carry a
green check, the sync card runs and plays back the first sync, and a
successful run reveals the completion footer - "All set. Playlists update
daily." beside a go-to-dashboard button (see
`docs/design/2026-07-12-welcome-flow-plan.md`).

## Section and tab names

- Dashboard tabs: **Artists**, **Concerts**, **Playlists** (each label carries
  a live count, e.g. "Artists (12)").
- Settings sections: **Daily Sync**, **Last.fm**, **Home City**,
  **Pinned Cities**, **Options**, **Listening History**, **Account**.
- Welcome flow sections: **Last.fm**, **Home City**, **Daily Sync** - the
  settings names exactly.

## Canonical sentences

Keep these exactly as written:

- Tagline: "Live-music discovery through listening."
- Intro: "NextFM finds upcoming concerts near you by artists that match your
  taste, and generates Spotify playlists for you to discover them." (The
  daily cadence isn't in the intro; the Daily Sync section name and the
  welcome completion footer carry it. "Taste" is a deliberate exception to
  the listening-history term below - the intro is the one place the
  shorthand takes precedence over the literal Last.fm mechanism.)
- Daily Sync section: "Imports listening history, suggests artists, finds
  concerts and generates playlists."
- Artists tab: "Artists you might like based on your listening history."
- Concerts tab: "Upcoming concerts near you by suggested artists."
- Playlists tab: "Spotify playlists tracking suggested concerts in your
  cities, updated daily."
- About page, playlist section: "Playlists in Spotify are automatically
  updated daily as your listening history and upcoming concerts change."
- Listening History section: "Your listening history is used to suggest
  artists and find concerts. Hidden artists are skipped."
- Confirmation email: "... and start discovering live music through
  listening."
