"use client";

import { SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { EmptyState } from "./empty-state";
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
          <EmptyState>
            No artists suggested. If you just signed up for Last.fm, wait for
            Last.fm to capture future listening history.
          </EmptyState>
        ) : (
          <RunSyncMessage action="suggest artists" />
        )
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {sortedArtists.map((userArtist) => (
              <li
                key={userArtist.artist.id}
                className="flex flex-col rounded border border-gray-300 p-3 text-sm dark:border-gray-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {userArtist.artist.name}
                  </span>
                  <span className="shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-xs whitespace-nowrap text-gray-500 dark:border-gray-700">
                    score {scoreOf(userArtist).toFixed(2)}
                  </span>
                </div>
                {reasonOf(userArtist) && (
                  <p className="mt-1 text-xs text-gray-500">
                    {reasonOf(userArtist)}
                  </p>
                )}
                {userArtist.listeners != null && (
                  <p className="mt-1.5 text-xs text-gray-500 italic">
                    {listenersFormat.format(userArtist.listeners)} listeners
                  </p>
                )}
                {(userArtist.tags ?? []).length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    {(userArtist.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
