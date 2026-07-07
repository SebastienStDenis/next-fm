"use client";

import {
  useActionState,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

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
};

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
}: {
  userId: string;
  hasCity: boolean;
  hasArtists: boolean;
  playlists: Playlist[];
}) {
  if (!hasArtists) {
    return (
      <p className="text-sm text-gray-500">
        Sync artists first to build playlists from shows near you.
      </p>
    );
  }

  return (
    <div>
      {!hasCity && (
        <p className="mb-2 text-sm text-gray-500">
          Set a city to get your local playlist; pinned cities work without
          one.
        </p>
      )}
      {playlists.length === 0 ? (
        <p className="text-sm text-gray-500">
          No playlists yet. Sync to create your first one on Spotify.
        </p>
      ) : (
        <ul className="space-y-3">
          {playlists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              userId={userId}
              playlist={playlist}
            />
          ))}
        </ul>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-medium">Pin another city</h3>
        <p className="mt-1 mb-2 text-sm text-gray-500">
          A pinned playlist tracks shows in a city of your choice, independent
          of where you live.
        </p>
        <PinCitySearch userId={userId} />
      </div>
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
                className="flex flex-wrap items-baseline gap-x-2 text-sm"
              >
                <span className="text-gray-500">{track.position + 1}.</span>
                <span>{track.title ?? "Unknown title"}</span>
                {track.artist && (
                  <span className="text-gray-500">by {track.artist.name}</span>
                )}
                {track.event && (
                  <span className="text-xs text-gray-500">
                    · playing {track.event.venue_name} on{" "}
                    {showDateFormat.format(new Date(track.event.starts_at))}
                  </span>
                )}
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

function PinCitySearch({ userId }: { userId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function select(city: City) {
    startTransition(async () => {
      const result = await createCityPlaylist(userId, city.geonameid);
      setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <CitySearchBox
        placeholder="Search for a city to pin"
        disabled={pending}
        onSelect={select}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
