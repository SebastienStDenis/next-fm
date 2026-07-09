"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

import type { City } from "./city-panel";

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
  hasCity,
  hasArtists,
  playlists,
}: {
  hasCity: boolean;
  hasArtists: boolean;
  playlists: Playlist[];
}) {
  if (!hasArtists) {
    return (
      <p className="text-sm text-gray-500">
        Nothing synced yet. Run a sync from{" "}
        <Link
          href="/dashboard/account"
          className="underline hover:text-foreground"
        >
          Account settings
        </Link>
        .
      </p>
    );
  }

  if (playlists.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {hasCity
          ? "No playlists yet. Sync to create your playlists on Spotify."
          : "Set a home city or pin a city in the Account section, then sync to create playlists."}
      </p>
    );
  }

  // Home-city playlist (null city) always leads, pinned cities follow.
  const ordered = [
    ...playlists.filter((playlist) => playlist.city === null),
    ...playlists.filter((playlist) => playlist.city !== null),
  ];

  return (
    <ul className="space-y-3">
      {ordered.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} />
      ))}
    </ul>
  );
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <li className="rounded border border-gray-300 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{playlist.name}</span>
        <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700">
          {playlist.city
            ? `pinned to ${playlist.city.name}`
            : "follows your home city"}
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
                <span
                  className="inline-block shrink-0 text-right tabular-nums text-gray-500"
                  style={{
                    width: `calc(${String(playlist.tracks.length).length}ch + 0.3rem)`,
                  }}
                >
                  {track.position + 1}.
                </span>
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
    </li>
  );
}
