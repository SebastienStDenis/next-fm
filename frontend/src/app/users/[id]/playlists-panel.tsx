"use client";

import {
  useActionState,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";

import { createCityPlaylist, deletePlaylist } from "./actions";
import type { City } from "./city-panel";
import { CitySearchBox } from "./city-search-box";

export type Playlist = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  city: City | null;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  last_synced_at: string | null;
  tracks: PlaylistTrack[];
};

type PlaylistTrack = {
  position: number;
  spotify_track_id: string;
  title: string | null;
  artist: { id: string; name: string } | null;
  event: {
    id: string;
    venue_name: string;
    starts_at: string;
  } | null;
  url: string | null;
};

export const PINNED_PLAYLIST_CAP = 2;

// Event times are stored as venue-local time labeled UTC, so formatting in
// UTC displays the original local time.
const showDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const syncedAtFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const emptySubscribe = () => () => {};

function SyncedAtLabel({ iso }: { iso: string }) {
  // Formats in the viewer's timezone, which the server can't know - render
  // only after hydration so server and client HTML always match.
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  return hydrated && ` · synced ${syncedAtFormat.format(new Date(iso))}`;
}

export function PlaylistsPanel({
  userId,
  hasCity,
  hasArtists,
  playlists,
  pendingPins,
  pinnedCount,
}: {
  userId: string;
  hasCity: boolean;
  hasArtists: boolean;
  playlists: Playlist[];
  pendingPins: Playlist[];
  pinnedCount: number;
}) {
  const homePlaylists = playlists.filter((playlist) => playlist.city === null);
  const pinnedPlaylists = playlists.filter((playlist) => playlist.city !== null);

  if (!hasArtists) {
    return (
      <p className="text-sm text-gray-500">
        Nothing synced yet. Run a sync from{" "}
        <Link
          href={`/users/${userId}/account`}
          className="underline hover:text-foreground"
        >
          Account settings
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold">Home city</h3>
        {!hasCity ? (
          <p className="mt-1 text-sm text-gray-500">
            Set your city in the Account section to get your local playlist.
          </p>
        ) : homePlaylists.length > 0 ? (
          <ul className="mt-2 space-y-3">
            {homePlaylists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                userId={userId}
                playlist={playlist}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            No playlist yet. Sync to create your local playlist on Spotify.
          </p>
        )}
      </section>

      <section>
        <h3 className="text-base font-semibold">Pinned cities</h3>
        {pinnedPlaylists.length > 0 && (
          <ul className="mt-2 space-y-3">
            {pinnedPlaylists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                userId={userId}
                playlist={playlist}
              />
            ))}
          </ul>
        )}
        {pendingPins.length > 0 && (
          <ul className="mt-3 space-y-1">
            {pendingPins.map((playlist) => (
              <PendingPinRow
                key={playlist.id}
                userId={userId}
                playlist={playlist}
              />
            ))}
          </ul>
        )}
        <div className="mt-3">
          <PinCitySearch
            userId={userId}
            atCap={pinnedCount >= PINNED_PLAYLIST_CAP}
          />
        </div>
      </section>
    </div>
  );
}

function PlaylistCard({
  userId,
  playlist,
}: {
  userId: string;
  playlist: Playlist;
}) {
  const [state, deleteAction, deleting] = useActionState(
    deletePlaylist.bind(null, userId, playlist.id),
    { error: null },
  );

  return (
    <li className="rounded border border-gray-300 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{playlist.name}</span>
        <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700">
          {playlist.city ? `pinned to ${playlist.city.name}` : "follows your city"}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {playlist.spotify_url ? (
          <a
            href={playlist.spotify_url}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            Open in Spotify ↗
          </a>
        ) : (
          "Not on Spotify yet - sync to create it."
        )}
        {playlist.last_synced_at && (
          <SyncedAtLabel iso={playlist.last_synced_at} />
        )}
      </p>
      {playlist.tracks.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-gray-500">
            Tracks ({playlist.tracks.length})
          </summary>
          <ol className="mt-2 space-y-1">
            {playlist.tracks.map((track) => (
              <li
                key={track.spotify_track_id}
                className="flex gap-x-2 text-sm"
              >
                <span className="text-gray-500">{track.position + 1}.</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span>{track.title ?? "Unknown title"}</span>
                    {track.artist && (
                      <span className="text-gray-500">by {track.artist.name}</span>
                    )}
                  </div>
                  {track.event && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      playing{" "}
                      {track.url ? (
                        <a
                          href={track.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {track.event.venue_name} on{" "}
                          {showDateFormat.format(new Date(track.event.starts_at))} ↗
                        </a>
                      ) : (
                        <>
                          {track.event.venue_name} on{" "}
                          {showDateFormat.format(new Date(track.event.starts_at))}
                        </>
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `Delete "${playlist.name}"? It will also be removed from Spotify.`,
            )
          ) {
            event.preventDefault();
          }
        }}
        className="mt-2 text-right"
      >
        <button
          type="submit"
          disabled={deleting}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete playlist"}
        </button>
      </form>
      {state.error && <p className="mt-1 text-sm text-red-600">{state.error}</p>}
    </li>
  );
}

// A pinned city whose Spotify playlist doesn't exist yet: shown so a fresh
// pin is visible before the first sync creates it, removable from here.
function PendingPinRow({
  userId,
  playlist,
}: {
  userId: string;
  playlist: Playlist;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deletePlaylist(userId, playlist.id);
      setError(result.error);
    });
  }

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
      <span>
        {playlist.city?.name}
        <span className="text-gray-500"> · awaiting first sync</span>
      </span>
      <span className="flex items-baseline gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          {pending ? "Removing..." : "Remove"}
        </button>
      </span>
    </li>
  );
}

function PinCitySearch({
  userId,
  atCap,
}: {
  userId: string;
  atCap: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function select(city: City) {
    startTransition(async () => {
      const result = await createCityPlaylist(userId, city.geonameid);
      setError(result.error);
      if (!result.error) {
        setOpen(false);
      }
    });
  }

  if (atCap) {
    return (
      <p className="text-sm text-gray-500">
        You can pin up to {PINNED_PLAYLIST_CAP} cities. Delete an existing pin to add another.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
      >
        + Add a playlist for another city
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <CitySearchBox
        placeholder="Search for a city to pin"
        disabled={pending}
        onSelect={select}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-xs text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
      >
        Cancel
      </button>
    </div>
  );
}
