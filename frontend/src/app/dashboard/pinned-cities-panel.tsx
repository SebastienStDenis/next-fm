"use client";

import { useState, useTransition } from "react";

import type { ActionState } from "./actions";
import { createCityPlaylist, deletePlaylist } from "./actions";
import type { City } from "./city-panel";
import { CitySearchBox, cityLabel } from "./city-search-box";
import type { Playlist } from "./playlists-panel";
import { useTransientError } from "./use-transient-error";

const PINNED_PLAYLIST_CAP = 2;

export function PinnedCitiesPanel({ pinned }: { pinned: Playlist[] }) {
  return (
    <div className="space-y-3">
      {pinned.length > 0 && (
        <ul className="space-y-1">
          {pinned.map((playlist) => (
            <PinnedCityRow key={playlist.id} playlist={playlist} />
          ))}
        </ul>
      )}
      <PinCitySearch atCap={pinned.length >= PINNED_PLAYLIST_CAP} />
    </div>
  );
}

function PinnedCityRow({ playlist }: { playlist: Playlist }) {
  const [result, setResult] = useState<ActionState>({ error: null });
  const error = useTransientError(result);
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
      setResult(await deletePlaylist(playlist.id));
    });
  }

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
      <span>{playlist.city && cityLabel(playlist.city)}</span>
      <span className="flex items-baseline gap-2">
        {error && !pending && (
          <span
            key={error.key}
            className="animate-fade-in-out text-xs text-red-600"
          >
            {error.message}
          </span>
        )}
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

function PinCitySearch({ atCap }: { atCap: boolean }) {
  const [result, setResult] = useState<ActionState>({ error: null });
  const error = useTransientError(result);
  const [pending, startTransition] = useTransition();

  function select(city: City) {
    startTransition(async () => {
      setResult(await createCityPlaylist(city.geonameid));
    });
  }

  return (
    <div className="space-y-2">
      <CitySearchBox
        placeholder={
          atCap
            ? "Remove an existing pin to add another"
            : "Add a playlist for another city"
        }
        disabled={atCap || pending}
        onSelect={select}
      />
      {error && !pending && (
        <p key={error.key} className="animate-fade-in-out text-xs text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}
