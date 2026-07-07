"use client";

import { useState, useTransition } from "react";

import { createCityPlaylist, deletePlaylist } from "./actions";
import type { City } from "./city-panel";
import { CitySearchBox } from "./city-search-box";
import type { Playlist } from "./playlists-panel";

export const PINNED_PLAYLIST_CAP = 2;

export function PinnedCitiesPanel({
  userId,
  pinned,
}: {
  userId: string;
  pinned: Playlist[];
}) {
  return (
    <div className="space-y-3">
      {pinned.length > 0 && (
        <ul className="space-y-1">
          {pinned.map((playlist) => (
            <PinnedCityRow
              key={playlist.id}
              userId={userId}
              playlist={playlist}
            />
          ))}
        </ul>
      )}
      <PinCitySearch
        userId={userId}
        atCap={pinned.length >= PINNED_PLAYLIST_CAP}
      />
    </div>
  );
}

// One pinned city, whether or not its Spotify playlist exists yet: a fresh pin
// shows "awaiting first sync" until a sync creates it, then links to Spotify.
function PinnedCityRow({
  userId,
  playlist,
}: {
  userId: string;
  playlist: Playlist;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    if (
      playlist.spotify_url &&
      !window.confirm(
        `Remove the playlist for ${playlist.city?.name}? It will also be removed from Spotify.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deletePlaylist(userId, playlist.id);
      setError(result.error);
    });
  }

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
      <span>
        {playlist.city?.name}
        {playlist.spotify_url ? (
          <>
            {" · "}
            <a
              href={playlist.spotify_url}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-gray-700 dark:hover:text-gray-300"
            >
              Open in Spotify ↗
            </a>
          </>
        ) : (
          <span className="text-gray-500"> · awaiting first sync</span>
        )}
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
        You can pin up to {PINNED_PLAYLIST_CAP} cities. Remove an existing pin to add another.
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
