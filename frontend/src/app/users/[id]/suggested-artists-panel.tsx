"use client";

import Link from "next/link";

import { SIMILAR_ARTIST_KIND } from "./artist-kinds";
import type { Interest, UserArtist } from "./taste-panel";

function suggestionOf(userArtist: UserArtist): Interest | undefined {
  return userArtist.interests.find(
    (interest) => interest.kind === SIMILAR_ARTIST_KIND,
  );
}

function scoreOf(userArtist: UserArtist): number {
  return suggestionOf(userArtist)?.weight ?? 0;
}

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
  userId,
  suggestedArtists,
}: {
  userId: string;
  suggestedArtists: UserArtist[];
}) {
  const sortedArtists = [...suggestedArtists].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || a.artist.name.localeCompare(b.artist.name),
  );

  return (
    <div>
      {suggestedArtists.length === 0 ? (
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
      ) : (
        <>
          <ul className="space-y-3">
            {sortedArtists.map((userArtist) => (
              <li key={userArtist.artist.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{userArtist.artist.name}</span>
                  <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700">
                    score {scoreOf(userArtist).toFixed(2)}
                  </span>
                </div>
                {reasonOf(userArtist) && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {reasonOf(userArtist)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
