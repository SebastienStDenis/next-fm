"use client";

import { useState, useTransition } from "react";

import { ignoreArtist, unignoreArtist } from "./actions";
import { KNOWN_ARTIST_KINDS } from "./artist-kinds";
import { IgnoreButton } from "./ignore-icons";

export type Artist = {
  id: string;
  name: string;
};

export type Interest = {
  kind: string;
  source: string;
  evidence: {
    rank?: number | null;
    playcount?: number | null;
    period?: string;
    track_count?: number;
    score?: number;
    paths?: { seed_artist_id: string; seed_name: string; match: number }[];
  };
  weight: number | null;
  created_at: string;
  updated_at: string;
};

export type UserArtist = {
  artist: Artist;
  interests: Interest[];
  excluded: boolean;
};

const numberFormat = new Intl.NumberFormat("en-US");

type SortKey = "rank" | "plays" | "loved" | "name";

function rankOf(userArtist: UserArtist): number {
  const rank = userArtist.interests.find(
    (interest) => interest.kind === "lastfm_top_artist",
  )?.evidence.rank;
  return rank ?? Number.MAX_SAFE_INTEGER;
}

function playsOf(userArtist: UserArtist): number {
  return (
    userArtist.interests.find((interest) => interest.kind === "lastfm_top_artist")
      ?.evidence.playcount ?? -1
  );
}

function lovedOf(userArtist: UserArtist): number {
  return (
    userArtist.interests.find((interest) => interest.kind === "lastfm_loved_tracks")
      ?.evidence.track_count ?? -1
  );
}

function byName(a: UserArtist, b: UserArtist): number {
  return a.artist.name.localeCompare(b.artist.name);
}

const comparators: Record<SortKey, (a: UserArtist, b: UserArtist) => number> = {
  name: byName,
  rank: (a, b) => rankOf(a) - rankOf(b) || byName(a, b),
  plays: (a, b) => playsOf(b) - playsOf(a) || byName(a, b),
  loved: (a, b) => lovedOf(b) - lovedOf(a) || byName(a, b),
};

function interestLabel(interest: Interest): string {
  if (interest.kind === "lastfm_top_artist") {
    const parts: string[] = [];
    if (interest.evidence.rank != null) {
      parts.push(`#${interest.evidence.rank}`);
    }
    if (interest.evidence.playcount != null) {
      parts.push(`${numberFormat.format(interest.evidence.playcount)} plays`);
    }
    if (parts.length > 0) {
      return parts.join(" · ");
    }
  }
  if (interest.kind === "lastfm_loved_tracks") {
    const count = interest.evidence.track_count ?? 0;
    return `${count} loved ${count === 1 ? "track" : "tracks"}`;
  }
  return interest.kind;
}

export function TastePanel({
  userId,
  userArtists,
}: {
  userId: string;
  userArtists: UserArtist[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Ignored artists stay listed (crossed out) until the next load; this tracks
  // the toggle in the meantime.
  const [ignoreOverlay, setIgnoreOverlay] = useState<Record<string, boolean>>(
    {},
  );
  const [, startTransition] = useTransition();
  const sortedArtists = [...userArtists].sort(comparators[sortKey]);

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
      {userArtists.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nothing synced yet. Sync your taste from the Suggestions section.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Artists you listen to ({numberFormat.format(userArtists.length)})
            </h3>
            <label className="text-xs text-gray-500">
              Sort by{" "}
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="rounded border border-gray-300 bg-transparent px-1 py-0.5 dark:border-gray-700"
              >
                <option value="rank">Top artist rank</option>
                <option value="plays">Most plays</option>
                <option value="loved">Most loved tracks</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <ul className="mt-2 space-y-1">
            {sortedArtists.map(({ artist, interests }) => (
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
                {interests
                  .filter((interest) => KNOWN_ARTIST_KINDS.has(interest.kind))
                  .map((interest) => (
                    <span
                      key={`${interest.kind}-${interest.source}`}
                      className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700"
                    >
                      {interestLabel(interest)}
                    </span>
                  ))}
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
