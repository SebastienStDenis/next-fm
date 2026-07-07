"use client";

import { useState, useTransition } from "react";

import { ignoreArtist, unignoreArtist } from "./actions";
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
  // Un-ignored artists stay listed here until the next load, toggled back to
  // active; this tracks the toggle in the meantime.
  const [ignoreOverlay, setIgnoreOverlay] = useState<Record<string, boolean>>(
    {},
  );
  const [, startTransition] = useTransition();

  const sortedArtists = [...ignoredArtists].sort((a, b) =>
    a.artist.name.localeCompare(b.artist.name),
  );

  function isIgnored(artistId: string): boolean {
    return ignoreOverlay[artistId] ?? true;
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
                <span
                  className={
                    isIgnored(artist.id) ? "text-gray-500 line-through" : ""
                  }
                >
                  {artist.name}
                </span>
                <IgnoreButton
                  ignored={isIgnored(artist.id)}
                  onClick={() => toggleIgnore(artist.id)}
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
