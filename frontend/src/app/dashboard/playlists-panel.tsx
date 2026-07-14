"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, CirclePlus, ExternalLink, X } from "lucide-react";

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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTitle,
} from "@/components/ui/popover";
import type { City } from "./city-panel";
import { EmptyStateCell } from "./empty-state";
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

// The playlist's own last write, distinct from the step markers on the tab
// description line - plain text, no check (see docs/wording.md). Formats in
// the viewer's timezone, which the server can't know - renders only after
// hydration so server and client HTML always match.
function SyncedAtLabel({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  if (!hydrated) {
    return null;
  }
  return (
    <span className="animate-fade-in text-xs text-muted-foreground">
      Synced {syncedAtFormat.format(new Date(iso))}
    </span>
  );
}

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

export function PlaylistsPanel({
  synced,
  playlists,
}: {
  synced: boolean;
  playlists: Playlist[];
}) {
  const columnCount = useColumnCount();
  const tip = useSavePlaylistTip();

  // Existing playlists always show (even if the latest run didn't complete
  // the playlists step); the run-a-sync hint is only for a truly empty panel.
  if (playlists.length === 0) {
    return synced ? (
      <EmptyStateCell>
        No playlists generated. NextFM will generate them on the next daily
        sync.
      </EmptyStateCell>
    ) : (
      <RunSyncMessage action="generate playlists" />
    );
  }

  // Home-city playlist (null city) always leads, pinned cities follow.
  const ordered = [
    ...playlists.filter((playlist) => playlist.city === null),
    ...playlists.filter((playlist) => playlist.city !== null),
  ];

  // The save-to-library tip anchors to the leading playlist only.
  const tipFor = (playlist: Playlist) =>
    tip && playlist.id === ordered[0]?.id ? tip : undefined;

  if (columnCount === null) {
    return (
      <ul className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} tip={tipFor(playlist)} />
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
            <PlaylistCard key={playlist.id} playlist={playlist} tip={tipFor(playlist)} />
          ))}
        </ul>
      ))}
    </div>
  );
}

type SavePlaylistTip = { open: boolean; onOpenChange: (open: boolean) => void };

// A one-shot nudge cued by `?tip=save-playlist` on the welcome-flow handoff.
// The cue is read only after hydration (the URL isn't known server-side, and
// deferring keeps server and client HTML in sync), then the param is stripped
// so a refresh or Back never replays it. Untriggered arrivals never leave the
// "uncued" phase, so no tip is rendered for them at all.
function useSavePlaylistTip(): SavePlaylistTip | undefined {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [phase, setPhase] = useState<
    "idle" | "uncued" | "pending" | "open" | "closed"
  >("idle");

  if (hydrated && phase === "idle") {
    const cued =
      new URLSearchParams(window.location.search).get("tip") ===
      "save-playlist";
    setPhase(cued ? "pending" : "uncued");
  }

  // Once cued, strip the one-shot param and hold a beat before opening, so the
  // tip animates in just after the page settles - the motion is what draws the
  // eye, rather than it sitting there from the first paint.
  useEffect(() => {
    if (phase !== "pending") {
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("tip") === "save-playlist") {
      url.searchParams.delete("tip");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    const timer = window.setTimeout(() => setPhase("open"), 450);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "open" || phase === "closed") {
    return {
      open: phase === "open",
      onOpenChange: (open) => setPhase(open ? "open" : "closed"),
    };
  }
  return undefined;
}

function PlaylistCard({
  playlist,
  tip,
}: {
  playlist: Playlist;
  tip?: SavePlaylistTip;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const spotifyLink = playlist.spotify_url && (
    <a
      href={playlist.spotify_url}
      target="_blank"
      rel="noreferrer"
      onClick={tip ? () => tip.onOpenChange(false) : undefined}
      className="inline-flex items-center gap-1 underline hover:text-foreground"
    >
      Open in Spotify
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );

  return (
    <li className="flex">
      <Card ref={cardRef} tabIndex={-1} size="sm" className="flex-1 outline-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="shrink-0 animate-fade-in" aria-hidden>
              <span className="block size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-primary" />
            </span>
            {playlist.name}
          </CardTitle>
          <CardDescription>
            {tip && spotifyLink ? (
              <Popover open={tip.open} onOpenChange={tip.onOpenChange}>
                <PopoverAnchor asChild>{spotifyLink}</PopoverAnchor>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={8}
                  // Stay pinned to the right of the link; without this Radix
                  // flips the tip to the far left of the screen on very narrow
                  // widths where the right side can't fit it. collisionPadding
                  // still feeds the available-width so the pill keeps a margin
                  // from the screen edge instead of hugging it.
                  avoidCollisions={false}
                  collisionPadding={12}
                  // Don't pull focus onto the dismiss button when the tip
                  // opens; put it on the card the tip is about.
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    cardRef.current?.focus();
                  }}
                  onInteractOutside={(event) => event.preventDefault()}
                  onEscapeKeyDown={(event) => event.preventDefault()}
                  className="relative w-auto max-w-[max(9rem,var(--radix-popper-available-width))] flex-row items-start gap-0.5 rounded-md py-0.5 pl-1.5 pr-0.5 ring-0 bg-primary text-xs text-primary-foreground shadow-lg duration-150 ease-out data-open:zoom-in-75"
                >
                  {/* Pinned to the first line, not the pill's center, so the
                      point keeps aiming at the link when the text wraps. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-[0.625rem] -left-[2px] size-1.5 -translate-y-1/2 rotate-45 bg-primary"
                  />
                  <PopoverTitle className="min-w-0 text-balance">
                    Save{" "}
                    <CirclePlus
                      className="inline size-3.5 -translate-y-px align-middle"
                      aria-hidden
                    />{" "}
                    in Spotify to listen anywhere
                  </PopoverTitle>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => tip.onOpenChange(false)}
                    className="-my-0.5 shrink-0 rounded p-1 text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </PopoverContent>
              </Popover>
            ) : (
              spotifyLink
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Collapsible>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <CollapsibleTrigger className="-mx-1.5 -my-0.5 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-muted dark:hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180">
                <span>
                  {playlist.tracks.length}{" "}
                  {playlist.tracks.length === 1 ? "track" : "tracks"}
                </span>
                <ChevronDown
                  className="size-3.5 transition-transform"
                  aria-hidden
                />
              </CollapsibleTrigger>
              {playlist.last_synced_at && (
                <SyncedAtLabel iso={playlist.last_synced_at} />
              )}
            </div>
            <CollapsibleContent>
              {playlist.tracks.length === 0 ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  No tracks found. NextFM will add new ones as your listening
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
