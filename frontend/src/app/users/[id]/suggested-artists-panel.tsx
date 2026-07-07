"use client";

import { useState, useTransition } from "react";

import { ignoreArtist, unignoreArtist } from "./actions";
import { SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { IgnoreButton } from "./ignore-icons";
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
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Ignored suggestions stay listed (crossed out) until the next load; this
  // tracks the toggle in the meantime.
  const [ignoreOverlay, setIgnoreOverlay] = useState<Record<string, boolean>>(
    {},
  );
  const [, startTransition] = useTransition();

  const sortedArtists = [...suggestedArtists].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || a.artist.name.localeCompare(b.artist.name),
  );

  function isIgnored(artistId: string): boolean {
    return ignoreOverlay[artistId] ?? false;
  }

  function toggleIgnore(artistId: string) {
    const next = !isIgnored(artistId);
    setPendingId(artistId);
    startTransition(async () => {
      const result = next
        ? await ignoreArtist(userId, artistId)
        : await unignoreArtist(userId, artistId);
      setPendingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setIgnoreOverlay((prev) => ({ ...prev, [artistId]: next }));
      setError(null);
    });
  }

  return (
    <div>
      {suggestedArtists.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nothing synced yet. Run a sync from the Account section to discover
          artists similar to the ones you listen to.
        </p>
      ) : (
        <>
          <h3 className="text-sm font-medium">
            Suggested artists ({suggestedArtists.length})
          </h3>
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
          <ul className="mt-2 space-y-1">
            {sortedArtists.map((userArtist) => (
              <li
                key={userArtist.artist.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span
                  className={
                    isIgnored(userArtist.artist.id)
                      ? "text-gray-500 line-through"
                      : ""
                  }
                >
                  {userArtist.artist.name}
                </span>
                <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700">
                  score {scoreOf(userArtist).toFixed(2)}
                </span>
                {reasonOf(userArtist) && (
                  <span className="text-xs text-gray-500">
                    {reasonOf(userArtist)}
                  </span>
                )}
                <IgnoreButton
                  ignored={isIgnored(userArtist.artist.id)}
                  onClick={() => toggleIgnore(userArtist.artist.id)}
                  disabled={pendingId === userArtist.artist.id}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
