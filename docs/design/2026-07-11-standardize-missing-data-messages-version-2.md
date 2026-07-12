# Standardize Missing Data (and Stale Data Messages)

*Written 2026-07-11 by Sébastien St-Denis.*

Supersedes `docs/design/2026-07-09-standardize-missing-data-messages.md`.

There are many places data from the daily sync can appear. We want to handle showing correct messages when there is no data or stale data, depending on what the scenario is. We want to keep it simple, idiomatic and streamlined across all scenarios.

Relevant places are:
1. Dashboard - Artists tab (suggested artists) [single relevant step is suggesting artists]
2. Dashboard - Concerts tab (suggested and known concerts) [single relevant step is finding concerts]
3. Dashboard - Playlists tab - list of playlists [single relevant step is generating playlists]
4. Dashboard - Playlists tab - tracklists within a playlist [single relevant step is generating playlists]
5. Account - Listening History [single relevant step is importing listening history]

# Stale Data

Never hide data for being stale. If there is data, show it. Doing otherwise leans toward lying to the user, which is bad. If data is stale, it's because the user's daily sync is disabled, and therefore a red dot is shown at the top of the page, so the user is already aware of the issue. No need to let them know elsewhere as well by degrading the existing experience.

In each section, show a date with the latest successful single relevant step (only consider the single relevant step type for each section; in practice, `GET /me/sync` reports the latest run only, so this means the step completed in the latest run, dated by that run's finish time). If there is no successful single relevant step, then show nothing in place of it. Style it with a green checkmark and a date, keep it minimal, right-aligned on the tab's description line. A few notes:
- Dashboard - Playlists tab - list of playlists: show the top-level date like the other tabs; each playlist card also keeps its own last sync date on the track-count line, as plain text without the checkmark (it's not a sync-step marker)
- Account - Listening History: don't show anything here, user can scroll up to see the latest state in the Daily Sync section.

# Missing Data

As mentioned earlier: if there is data then show it, end of story. Even on the concerts tab, if there are no suggested artists events and only known artists events (which are hidden by the default filter selection), just show a '<n> concerts hidden by filters' ghost box in the concerts grid, sized like the concert cards (it takes the slot after any visible concerts), and that's it. Only proceed if there is truly no data to show.

In all cases, if there is no data to show, then show the ghost card with a relevant message in it, sized like one result card in the same grid the results would use (not full width). Exceptions:
- Dashboard - Playlists tab - tracklists within a playlist: show the 0 tracks dropdown with the error message within the dropdown, no card since it's already in a card.
- Account - Listening History : just show the message, no card since it's already in a card

The first thing to check, if there is no data, is whether the latest sync run completed the single relevant step (`GET /me/sync` reports the latest run only; no deeper history is consulted).

If the latest run has no successful single relevant step, then show the standard 'Run a sync in Account to <action>'. No need to concern ourselves with the scenario of successful syncs aging out of history - syncs happen every 24 hours, and if the user's sync is disabled then they'll see the red dot at the top of the page.

If the latest run has a successful single relevant step but there is still no data, then mention that things will appear as new data flows in, along with optional guidance per section. Standardize these messages to the format: "No <result> <actioned>. <Optional guidance per scenario>. <Note that new data will appear as things change>."
1. Dashboard - Artists tab (suggested artists): note about new Last.fm accounts
2. Dashboard - Concerts tab (suggested and known concerts): note about no concerts in the area
3. Dashboard - Playlists tab - list of playlists: reachable when the home city was removed after a successful sync - keep the guidance to set the home city in Account, and skip the new-data note (nothing flows in without a city)
4. Account - Listening History: note about new Last.fm accounts