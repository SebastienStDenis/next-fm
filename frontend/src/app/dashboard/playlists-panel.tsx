"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { City } from "./city-panel";
import { EmptyState } from "./empty-state";
import { RunSyncMessage } from "./run-sync-message";

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

// Playlist cards stack per column (masonry-ish) so an expanded tracklist
// only pushes down cards in its own column. The column count mirrors the
// grid breakpoints the other tabs use; ordered by matchMedia specificity.
const COLUMN_QUERIES: [string, number][] = [
  ["(min-width: 64rem)", 3],
  ["(min-width: 40rem)", 2],
];

function subscribeToColumnCount(onChange: () => void): () => void {
  const lists = COLUMN_QUERIES.map(([query]) => window.matchMedia(query));
  for (const list of lists) {
    list.addEventListener("change", onChange);
  }
  return () => {
    for (const list of lists) {
      list.removeEventListener("change", onChange);
    }
  };
}

function readColumnCount(): number {
  for (const [query, count] of COLUMN_QUERIES) {
    if (window.matchMedia(query).matches) {
      return count;
    }
  }
  return 1;
}

// null until hydration: the server can't know the viewport, so the first
// render uses the breakpoint grid instead (visually identical while all
// tracklists are collapsed).
function useColumnCount(): number | null {
  return useSyncExternalStore(
    subscribeToColumnCount,
    readColumnCount,
    () => null,
  );
}

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
  synced,
  playlists,
}: {
  synced: boolean;
  playlists: Playlist[];
}) {
  const columnCount = useColumnCount();

  if (!synced) {
    return <RunSyncMessage action="generate playlists" />;
  }

  if (playlists.length === 0) {
    return (
      <EmptyState>
        No playlists generated. Set your home city in{" "}
        <Link
          href="/dashboard/account"
          className="underline hover:text-foreground"
        >
          Account
        </Link>
        .
      </EmptyState>
    );
  }

  // Home-city playlist (null city) always leads, pinned cities follow.
  const ordered = [
    ...playlists.filter((playlist) => playlist.city === null),
    ...playlists.filter((playlist) => playlist.city !== null),
  ];

  if (columnCount === null) {
    return (
      <ul className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} />
        ))}
      </ul>
    );
  }

  const columns = Array.from({ length: columnCount }, (_, column) =>
    ordered.filter((_, index) => index % columnCount === column),
  );
  return (
    <div className="flex items-start gap-3">
      {columns.map((column, index) => (
        <ul key={index} className="flex min-w-0 flex-1 flex-col gap-3">
          {column.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </ul>
      ))}
    </div>
  );
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  return (
    <li className="flex">
      <Card size="sm" className="flex-1">
        <CardHeader>
          <CardTitle>{playlist.name}</CardTitle>
          <CardDescription>
            {playlist.spotify_url ? (
              <a
                href={playlist.spotify_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline hover:text-foreground"
              >
                Open in Spotify
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              "Not on Spotify yet - sync to generate it."
            )}
            {playlist.last_synced_at && (
              <SyncedAtLabel iso={playlist.last_synced_at} />
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Collapsible>
            <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&[data-state=open]>svg]:rotate-180">
              <span>
                {playlist.tracks.length}{" "}
                {playlist.tracks.length === 1 ? "track" : "tracks"}
              </span>
              <ChevronDown
                className="size-3.5 transition-transform"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {playlist.tracks.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No tracks found. We&apos;ll add new ones as your listening
                  history and upcoming concerts change.
                </p>
              ) : (
                <ol className="mt-2 space-y-1">
                  {playlist.tracks.map((track) => (
                    <li
                      key={track.spotify_track_id}
                      className="flex items-center gap-x-2 text-sm"
                    >
                      <span
                        className="flex h-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] tabular-nums text-muted-foreground"
                        style={{
                          minWidth: `calc(${String(playlist.tracks.length).length}ch + 0.5rem)`,
                        }}
                      >
                        {track.position + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-1">
                          <span className="min-w-0">
                            {track.title ?? "Unknown title"}
                          </span>
                          {track.artist && (
                            <span className="min-w-0 text-muted-foreground">
                              by {track.artist.name}
                            </span>
                          )}
                        </div>
                        {track.event && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            playing{" "}
                            {track.url ? (
                              <a
                                href={track.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:text-foreground"
                              >
                                {track.event.venue_name} on{" "}
                                {showDateFormat.format(
                                  new Date(track.event.starts_at),
                                )}
                              </a>
                            ) : (
                              <>
                                {track.event.venue_name} on{" "}
                                {showDateFormat.format(
                                  new Date(track.event.starts_at),
                                )}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </li>
  );
}
