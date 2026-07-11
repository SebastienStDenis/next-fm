"use client";

import { useState, useTransition } from "react";

import type { ActionState } from "./actions";
import { createCityPlaylist, deletePlaylist } from "./actions";
import type { City } from "./city-panel";
import { CitySearchBox, cityLabel } from "./city-search-box";
import type { Playlist } from "./playlists-panel";
import { Spinner } from "../spinner";
import { useTransientError } from "./use-transient-error";
import { XMark } from "./x-mark";

const PINNED_PLAYLIST_CAP = 2;

export function PinnedCitiesPanel({ pinned }: { pinned: Playlist[] }) {
  const [result, setResult] = useState<ActionState>({ error: null });
  const error = useTransientError(result);
  const [pending, startTransition] = useTransition();
  // The city just picked, shown as a placeholder row with a spinner until
  // the pin action's revalidated payload delivers the real row.
  const [adding, setAdding] = useState<City | null>(null);

  const atCap = pinned.length >= PINNED_PLAYLIST_CAP;

  function pin(city: City) {
    setAdding(city);
    startTransition(async () => {
      setResult(await createCityPlaylist(city.geonameid));
    });
  }

  return (
    <div className="space-y-3">
      {(pinned.length > 0 || (pending && adding)) && (
        <ul className="space-y-1">
          {pinned.map((playlist) => (
            <PinnedCityRow key={playlist.id} playlist={playlist} />
          ))}
          {pending && adding && (
            <li className="flex items-center justify-between gap-x-2 text-sm">
              <span className="min-w-0">{cityLabel(adding)}</span>
              <span className="flex text-gray-500">
                <Spinner />
              </span>
            </li>
          )}
        </ul>
      )}
      <div className="space-y-2">
        <CitySearchBox
          placeholder={
            atCap
              ? "Remove an existing pin to add another"
              : "Add a playlist for another city"
          }
          disabled={atCap || pending}
          onSelect={pin}
        />
        {error && !pending && (
          <p key={error.key} className="animate-fade-in-out text-xs text-red-600">
            {error.message}
          </p>
        )}
      </div>
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
    // The row never wraps: a long city name breaks onto extra lines inside
    // its own span while the remove control stays right, centered on them.
    <li className="flex items-center justify-between gap-x-2 text-sm">
      <span className="min-w-0">
        {playlist.city && cityLabel(playlist.city)}
      </span>
      <span className="flex items-baseline gap-2">
        {error && !pending && (
          <span
            key={error.key}
            className="animate-fade-in-out text-xs text-red-600"
          >
            {error.message}
          </span>
        )}
        {pending ? (
          <span className="flex self-center text-gray-500">
            <Spinner />
          </span>
        ) : (
          <button
            type="button"
            onClick={remove}
            aria-label={`Remove ${playlist.city?.name ?? "pinned city"}`}
            title="Remove"
            className="-m-1 flex self-center rounded p-1 text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <XMark className="h-4 w-4" />
          </button>
        )}
      </span>
    </li>
  );
}

