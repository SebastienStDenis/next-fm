"use client";

import { useState, useTransition } from "react";

import { unignoreArtist } from "./actions";
import { IgnoreButton } from "./ignore-icons";
import type { UserArtist } from "./taste-panel";

export function IgnoredArtistsPanel({
  userId,
  ignoredArtists,
}: {
  userId: string;
  ignoredArtists: UserArtist[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sortedArtists = [...ignoredArtists].sort((a, b) =>
    a.artist.name.localeCompare(b.artist.name),
  );

  function unignore(artistId: string) {
    setPendingId(artistId);
    startTransition(async () => {
      const result = await unignoreArtist(userId, artistId);
      setPendingId(null);
      setError(result.error);
    });
  }

  return (
    <div>
      {ignoredArtists.length === 0 ? (
        <p className="text-sm text-gray-500">
          You haven&apos;t ignored any artists. Ignoring one stops it from being
          suggested or matched to concerts.
        </p>
      ) : (
        <>
          <h3 className="text-sm font-medium">
            Ignored artists ({ignoredArtists.length})
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Never suggested, seeded, or matched to concerts. Un-ignoring lets an
            artist earn suggestions again from your next sync.
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <ul className="mt-2 space-y-1">
            {sortedArtists.map(({ artist }) => (
              <li
                key={artist.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="text-gray-500 line-through">{artist.name}</span>
                <IgnoreButton
                  ignored
                  onClick={() => unignore(artist.id)}
                  disabled={pendingId === artist.id}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
