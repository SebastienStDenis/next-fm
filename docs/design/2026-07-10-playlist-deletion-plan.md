# Playlist deletion and orphan cleanup design

*Written 2026-07-10 by Claude (Fable 5).*

Every playlist we create lives on the app's bot Spotify account, publicly. The playlist
plan (`docs/design/2026-07-06-playlist-plan.md`) named the failure mode - "an orphaned
public playlist on the bot account is the failure mode to avoid" - and left one piece
explicitly unbuilt: unfollowing on account deletion. This doc inventories every flow
that can strand a remote playlist, and designs one mechanism that covers them all
without introducing races with users deleting and recreating playlists.

An orphan here means: a playlist that exists on the bot's Spotify account with no
`playlists` row claiming its `spotify_playlist_id`. Orphans never heal on their own -
sync only touches playlists it has rows for - and they accumulate as public clutter on
the account whose cleanliness anti-abuse tooling watches.

## Inventory: every way to strand a remote playlist

**A. Account deletion (`DELETE /me`) - the big gap, exists today.** `delete_me`
deletes the user row and lets the FK cascade remove the `playlists` rows. Nothing
touches Spotify. Every playlist the user ever had becomes a permanent orphan. This is
the "remaining piece to build" from the playlist plan.

**B. Pinned-city removal (`DELETE /me/playlists/{id}`) - mostly handled, two cracks.**
The endpoint unfollows on Spotify first, then deletes the row. That order protects the
remote side, but: (1) if the process dies between the unfollow and the commit, the
local row survives pointing at a soft-deleted remote playlist, and the next sync
happily pushes names and tracks into it (Spotify keeps unfollowed playlists writable
for ~90 days); (2) the deletion is hostage to Spotify being up - during an outage or
an expired refresh token (they expire every 6 months), users cannot delete a playlist
at all.

**C. Lazy-create crash window - exists today, self-aware.** `_sync_playlist` creates
the remote playlist, then immediately commits the returned id precisely because losing
it would orphan the playlist (the comment in `playlist_sync.py` says so). The window
between the Spotify call succeeding and the commit landing is small but real: a crash
there leaves a remote playlist no local row has ever referenced. No amount of
transactional discipline closes this - the id doesn't exist until Spotify assigns it.

**D. Concurrent double-create.** `POST /me/playlists/sync` runs `sync_user_playlists`
directly in the API process; the Temporal `sync_playlists` activity runs the same
function. Nothing serializes them (the Temporal workflow id dedupes workflow against
workflow, but not against the direct endpoint). Two concurrent runs can both read
`spotify_playlist_id IS NULL`, both create a remote playlist, and both write their id
to the same row - last commit wins, the loser's remote playlist is orphaned.

**E. Delete racing an in-flight sync.** A user deletes a pinned playlist (or their
account) while a sync holds the playlist row in memory:

- If the row had no remote id yet, the sync creates one, then commits an UPDATE that
  matches zero rows (SQLAlchemy raises `StaleDataError`). The sync fails loudly, but
  the just-created remote playlist is an orphan.
- If the row had a remote id, the sync's full-replace write lands on an
  already-unfollowed playlist. Benign - writes don't re-follow, Spotify purges it -
  but worth stating.

**F. City-row deletion - theoretical today, wrong by construction.**
`playlists.city_id` is `ON DELETE SET NULL`. Deleting a city would try to turn a
pinned playlist into a second `(user_id, kind, NULL)` row and trip the
nulls-not-distinct unique constraint; the city delete fails instead. The seed only
upserts, so this can't fire today, but the FK encodes the wrong intent: a pin whose
city vanished is meaningless and should go away (remote side included).

**G. Everything not written yet.** Admin tooling deleting rows over raw SQL, a future
"disable playlists" toggle, a support script. Any path that deletes a `playlists` row
and forgets Spotify recreates gap A.

Adjacent but distinct - **stale, not orphaned**: clearing the home city
(`DELETE /me/city`) makes sync skip the default playlist (`no_city`), freezing its
last tracklist on Spotify indefinitely. The row still owns the remote playlist, so
it's not an orphan, but the frozen concert list is wrong the day after the first show
passes. Handled in its own section below.

## Design

One invariant, enforced by construction:

> **Whenever a `playlists` row with a `spotify_playlist_id` is deleted, that id is
> durably recorded in the same transaction; a recorded id is unfollowed at least
> once, eventually.** Remote creations that never reached a committed row (C) are the
> one class this can't capture; a low-frequency audit catches those.

Deletion becomes local-first and asynchronous-tolerant: the transaction that removes
local intent also enqueues the remote cleanup, an inline attempt keeps the common case
immediate, and retries are someone else's (the nightly job's) problem. This is the
reconciliation philosophy the sync already lives by, extended to the delete side:
deletion is a recorded desired state ("this remote id should not exist"), not a
best-effort imperative call.

### 1. The tombstone table

```
spotify_playlist_tombstones   -- remote ids owed an unfollow
  id                   uuidv7 PK
  spotify_playlist_id  str (unique)
  source               str          -- "delete" | "audit"
  created_at           timestamptz
```

A row means "unfollow this id, then delete me". The drainer (below) processes rows
until the table is empty; success (including a 404/400 from Spotify - already gone)
deletes the row. The table is a queue, not a log: no `unfollowed_at`, no history.
Unfollow is idempotent on Spotify's side, so at-least-once is safe.

Tombstones deliberately store the **remote id only** - never the user, kind, or city.
This is what makes delete-then-recreate race-free (see the race analysis): a new
playlist for the same city is a new row with a new remote id, and no tombstone can
ever refer to it.

### 2. Capture: a `BEFORE DELETE` trigger on `playlists`

```sql
CREATE FUNCTION tombstone_spotify_playlist() RETURNS trigger AS $$
BEGIN
  IF OLD.spotify_playlist_id IS NOT NULL THEN
    INSERT INTO spotify_playlist_tombstones (id, spotify_playlist_id, source)
    VALUES (uuidv7(), OLD.spotify_playlist_id, 'delete')
    ON CONFLICT (spotify_playlist_id) DO NOTHING;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER playlists_tombstone BEFORE DELETE ON playlists
  FOR EACH ROW EXECUTE FUNCTION tombstone_spotify_playlist();
```

A trigger rather than app code, and it's worth being explicit about why, because the
codebase has no triggers yet. The models define no ORM relationships; user deletion
relies on the DB-level FK cascade, which SQLAlchemy never sees - so there is no ORM
event to hook. App-level capture would mean every deleting code path (the endpoint,
`delete_me`, flows F and G, whatever comes next) must remember to enumerate remote ids
first, and the whole point of this design is that forgetting must be impossible.
Postgres fires row-level triggers on cascaded deletes, so the trigger makes the
invariant hold for `DELETE /me` **with no change to `delete_me` at all**, and for
every future deletion path for free.

Cost: Alembic autogenerate doesn't manage triggers, so the migration is hand-written
(`op.execute`), and the trigger is invisible to a reader of `models.py`. A comment on
the `Playlist` model pointing at the migration keeps it discoverable.

### 3. Inline attempt + nightly drainer

Enqueue-only deletion would make "delete playlist" feel broken (the public playlist
lingers until the next nightly run), so deleting endpoints keep an inline attempt -
but after the commit, and non-fatally:

- **`DELETE /me/playlists/{id}`**: delete the row (trigger captures the id), commit,
  then best-effort unfollow; on success delete the tombstone (and commit again). Any
  Spotify failure is swallowed - the response is 204 either way, because the deletion
  *has* happened; only the remote cleanup is pending. This inverts today's order and
  fixes both cracks in B: no zombie window (local intent dies first), and deletion
  works during Spotify outages.
- **`DELETE /me`**: unchanged deletion logic (Supabase auth user, then the app row;
  the cascade fires the trigger per playlist), then the same post-commit best-effort
  pass over that user's captured tombstones. A user with the maximum of three
  playlists costs three unfollow calls; failures wait for the drainer.

The **drainer** is a new Temporal activity, `drain_playlist_tombstones`, appended to
`DispatchSyncsWorkflow` after the per-user syncs: select all tombstones (skipping
`audit` rows younger than the confirmation age, next section), unfollow each, delete
on success, leave on failure for tomorrow. It needs no new scheduler, no new
infrastructure, and its natural volume is zero rows.

### 4. Closing the create races: claim by compare-and-set

The lazy create in `_sync_playlist` changes from "assign and commit" to a claim:

```python
result = await session.execute(
    update(Playlist)
    .where(Playlist.id == playlist.id, Playlist.spotify_playlist_id.is_(None))
    .values(spotify_playlist_id=data.id, spotify_url=data.url, ...)
    .returning(Playlist.id)
)
await session.commit()
if result.scalar_one_or_none() is None:
    # Lost the claim: another sync already attached a remote playlist, or the
    # row was deleted mid-sync. Our creation is unwanted either way.
    await spotify.unfollow_playlist(data.id)   # on failure: insert a tombstone
    ...re-read the row; sync the winner's id if the row survives, else skip...
```

This is the same insert-then-select adoption idiom the codebase already uses for
concurrent default-playlist creation and Spotify artist resolution, applied to the
UPDATE case. It closes D (the loser cleans up its own remote playlist instead of
orphaning the winner's... or rather, instead of overwriting the winner and orphaning
it) and the create half of E (row deleted mid-sync: zero rows match, self-cleanup,
no `StaleDataError` surprise). If the loser's cleanup unfollow itself fails, it
inserts a tombstone directly - the invariant holds because the id is either
unfollowed or recorded.

The replace half of E (full-replace write landing on an already-unfollowed playlist)
needs no fix: the write doesn't re-follow, the sync's final commit fails on the
missing row, and the tombstone from the delete already covers the id. Accepted as
benign.

### 5. The audit: yes, a background job - but a safety net, not the mechanism

Do we need a background job hunting orphans? Yes, but narrowly. The tombstone path
handles every flow where a committed row ever held the id - which is all of them
except C (crash between the Spotify create and the claim commit) and bugs we haven't
written yet. Those leak silently and permanently without an outside check, so:

**`audit_bot_playlists`**, a second activity on the nightly dispatch workflow:

1. List the bot account's own playlists (`GET /v1/me/playlists`, paged).
2. Diff against `playlists.spotify_playlist_id` ∪ tombstoned ids.
3. Insert unknown ids as tombstones with `source = 'audit'`.
4. The drainer only processes `audit` tombstones older than 24 hours, and re-checks
   at drain time that the id is *still* unclaimed by any `playlists` row - if a row
   claims it now, delete the tombstone and move on.

Steps 3-4 are what make the audit race-free against lazy creation. The moment of
danger is an id Spotify has assigned but no transaction has committed yet; that
window is seconds, and the 24-hour confirmation age plus the drain-time re-check mean
a legitimately claimed id is never unfollowed. There is no ordering of "list, then
unfollow immediately" that achieves this, because Spotify playlists expose no
creation timestamp to age-gate on.

The audit finding anything is a bug signal, not routine operation - log it loudly.
Expected volume: zero rows, forever, which is exactly what a safety net should cost.

**Phase 0 caveat, same discipline as the playlist plan**: `GET /v1/me/playlists` was
not among the endpoints `app.spotify_verify` exercised. It reads the bot's own
library, so development mode almost certainly allows it, but verify empirically
before building the audit. If Spotify has removed it, ship everything else and accept
C as a logged, unpatchable window (the claim-CAS already shrinks it to a process
crash in a ~hundred-millisecond span).

### 6. Race analysis: delete, recreate, and concurrent syncs

The scenarios that must not misfire, and why they don't:

- **Delete a pinned city, immediately re-pin the same city.** The re-pin can only
  succeed after the delete commits (the `(user_id, kind, city_id)` unique constraint
  blocks it before). The new row is a new uuid with `spotify_playlist_id NULL`; its
  first sync creates a *new* remote playlist. The old remote id lives only in the
  tombstone. The inline unfollow of the old id and the creation of the new one can
  interleave arbitrarily - they name different remote ids. Nothing can cross-fire
  because tombstones carry ids, not (user, city) targets.
- **Delete while the nightly sync is mid-flight.** Covered by the claim-CAS (create
  half) and the benign-write argument (replace half) in section 4. Worst case the
  sync item errors for that playlist; the next run has consistent state.
- **Two syncs race the lazy create.** One claim wins; the loser unfollows its own
  creation and adopts the winner's id. Deterministic, no orphan.
- **Drainer vs. everything.** The drainer only ever unfollows ids that no committed
  row claims (`delete` tombstones by the trigger's construction, `audit` tombstones
  by the drain-time re-check). A remote id can't migrate between rows -
  `spotify_playlist_id` is unique and only ever written by the claim - so "no row
  claims it now" is permanent.
- **Account deletion while syncing.** `_ensure_default_playlist`'s insert fails on
  the FK once the user row is gone; earlier steps fall under the mid-flight case
  above. Anything that still slips a remote create through lands in the audit.

### 7. Adjacent fixes riding along

- **Clearing the home city freezes the playlist (stale, not orphaned).** Change the
  `no_city` handling in `sync_user_playlists`: instead of skipping, reconcile the
  playlist to the empty tracklist (the verified `{"uris": []}` replace) and leave
  name and description as they were. The playlist is the user's durable home-city
  surface - it should read as empty, not as a concert list from a city they told us
  to forget. Setting a city again refills it on the next sync. (Only the write is
  new; desired-state-is-empty already falls out of having no city to match against.)
- **`playlists.city_id` becomes `ON DELETE CASCADE`** (from `SET NULL`). A pin whose
  city vanished should die, and with the trigger in place the cascade tombstones its
  remote id for free - flow F goes from "fails weirdly on a constraint" to correct
  with a one-line FK change.

## What this deliberately doesn't do

- **No soft-delete / `deleted_at` on `playlists`.** Local intent stays binary (the
  row exists or it doesn't); the tombstone table carries the only deferred state, and
  only for the remote side. Soft-deleted rows would leak into every query that
  forgets the filter - the unique constraints alone (`(user_id, kind, city_id)`,
  `spotify_playlist_id`) would need rethinking.
- **No serialization of syncs.** Funneling `POST /me/playlists/sync` through Temporal
  or per-user advisory locks would also close race D, but at the cost of new moving
  parts for one code path the claim-CAS fixes in four lines. If more per-user write
  races appear later, revisit.
- **No reconciling *toward* Spotify.** The audit only ever deletes remote playlists
  unknown locally; it never adopts them. Local rows are the single source of intent.

## Phases

**Phase 1 - capture and drain.** Migration: tombstone table, trigger, `city_id` FK
change. `unfollow_playlist` already exists on the client. Rework
`DELETE /me/playlists/{id}` to delete-then-unfollow; add the post-commit unfollow
pass to `delete_me`. Add `drain_playlist_tombstones` to the worker and dispatch
workflow. This alone fixes A, B, F, and G.

**Phase 2 - claim-CAS in the lazy create.** The `_sync_playlist` change plus loser
cleanup. Fixes D and E. Unit-testable with two sessions against the same row.

**Phase 3 - audit.** Verify `GET /v1/me/playlists` in development mode (extend
`app.spotify_verify`), add `list_own_playlists` to `SpotifyClient`, and the
`audit_bot_playlists` activity with the 24-hour confirmation gate. Fixes C.

**Phase 4 - empty-on-no-city.** The `no_city` reconcile-to-empty behavior, with the
sync item reporting it distinctly so the UI can explain the empty playlist.
