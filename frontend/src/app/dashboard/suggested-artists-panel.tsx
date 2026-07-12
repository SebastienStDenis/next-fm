"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { EmptyStateCell } from "./empty-state";
import { RunSyncMessage } from "./run-sync-message";
import type { Interest, UserArtist } from "./taste-panel";

function suggestionOf(userArtist: UserArtist): Interest | undefined {
  return userArtist.interests.find(
    (interest) => interest.kind === SIMILAR_ARTIST_KIND,
  );
}

function scoreOf(userArtist: UserArtist): number {
  return suggestionOf(userArtist)?.weight ?? 0;
}

const listenersFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
});

function reasonOf(userArtist: UserArtist): string | null {
  const seeds = suggestionOf(userArtist)
    ?.evidence.paths?.map((path) => path.seed_name)
    .filter(Boolean);
  if (!seeds || seeds.length === 0) {
    return null;
  }
  return `because you listen to ${seeds.join(", ")}`;
}

export function SuggestedArtistsPanel({
  suggestedArtists,
  synced,
}: {
  suggestedArtists: UserArtist[];
  synced: boolean;
}) {
  const sortedArtists = [...suggestedArtists].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || a.artist.name.localeCompare(b.artist.name),
  );

  return (
    <div>
      {suggestedArtists.length === 0 ? (
        synced ? (
          <EmptyStateCell>
            No artists suggested. If you just signed up for Last.fm, wait for
            Last.fm to capture future listening history. NextFM will suggest
            new artists as your listening history changes.
          </EmptyStateCell>
        ) : (
          <RunSyncMessage action="suggest artists" />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedArtists.map((userArtist) => (
            <li key={userArtist.artist.id} className="min-w-0">
              <Card size="sm" className="h-full">
                <CardHeader className="flex items-center justify-between gap-2">
                  <CardTitle className="min-w-0 break-words">
                    {userArtist.artist.name}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="shrink-0 px-1.5 text-muted-foreground"
                  >
                    <span
                      className="size-1.5 rounded-full bg-primary"
                      aria-hidden
                    />
                    score {scoreOf(userArtist).toFixed(2)}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-1">
                  {reasonOf(userArtist) && (
                    <p className="text-xs text-muted-foreground">
                      {reasonOf(userArtist)}
                    </p>
                  )}
                  {userArtist.listeners != null && (
                    <p className="text-xs text-muted-foreground italic">
                      {listenersFormat.format(userArtist.listeners)} listeners
                    </p>
                  )}
                  {(userArtist.tags ?? []).length > 0 && (
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                      {(userArtist.tags ?? []).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="max-w-full"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
