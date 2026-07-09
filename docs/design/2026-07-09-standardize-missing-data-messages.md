# Standardize Missing Data Messages

*Written 2026-07-09 by Sébastien St-Denis.*

there are many places where we show results from syncs. I want to make it clear with a standard interface in each of these, when there is no data, whether it is because the user has not synced (or there is no history of a sync), vs a sync having run and succersfully retrieved nothing.

## My Artists

If the list is empty and the latest me/sync does not show a successful last.fm import step, show:

  "Run a sync above to import listening history."

If the list is empty and the latest me/sync does not show a successful last.fm import step, show:

  "No listening history imported. If you just signed up for Last.fm, wait for Last.fm to capture future listening history."

## Suggested artists tab

If the list is empty and the latest me/sync does not show a successful suggestion sync step, show:

  "Run a sync in Account (link) to suggest artists."

If the list is empty and the latest me/sync does show a successful suggestion sync step:

  "No artists suggested. If you just signed up for Last.fm, wait for Last.fm to capture future listening history."

## Concerts tab

If the list is empty and the latest me/sync does not show a successful event sync step, show:

  "Run a sync in Account (link) to find concerts."

If the list is empty and the latest me/sync does show a successful event sync step, show:

  "No concerts found. Try a different city."

## Playlists tab

If the list is empty and the latest me/sync does not show a successful playlist step, show:

  "Run a sync in Account (link) to generate playlists."

If the list is empty and the latest me/sync does show a successful playlist step, show:

  "No playlists generated. Set your home city in Account (link)."

## Empty song lists within a playlist

  "No songs found. We'll add new ones as your listening history and upcoming concerts change."

# Also, standardize wording throughout the website:

Use the terms "listening history" (not taste), "suggested artists", "concerts" (not events or shows), "playlists".

Listening history is "imported"/"importing".
Artists are "suggested/"suggesting". When using the verb, use artists instead of suggested artists (Suggesting suggested artists in redundant)
Concerts are "found"/"finding".
Playlists are "generated"/"generating".

Reword the description under Sync to:

  Imports listening history, suggests artists, finds concerts and generates playlists. Re-runs automatically on a cadence.

Rename suggested artists tab to Artists. rename "My Artists" section to "Listening History". Rename My Artists button under Upcoming conerts to Listening History.



Leave this sentence as-is: We find upcoming concerts near you by artists that match your taste, and generate Spotify playlists for you to discover them.

Tweak the about section to follow these naming conventions.

leave this sentence as-is: Live-music discovery through listening.

Update the mail template to "... and start discovering live music through listening."

Reword "Spotify playlists tracking suggested concerts in your cities." to "Spotify playlists tracking upcoming concerts in your cities. Tracklists are automatically updated as your listening history and upcoming concerts change.

Leave "Upcoming concerts near you by suggested artists." as is.

Also create a wording doc (maybe pick different name) highlighting these wording rules/conventions. And move all the existing design docs to a sub-folder (name it well) under docs.

