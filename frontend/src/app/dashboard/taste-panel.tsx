"use client";

import { useState, useTransition } from "react";

import { setArtistIgnored } from "./actions";
import { KNOWN_ARTIST_KINDS } from "./artist-kinds";

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

function IgnoreIcon({ ignored }: { ignored: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      {ignored ? (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      )}
    </svg>
  );
}

export function TastePanel({
  userArtists,
  synced,
}: {
  userArtists: UserArtist[];
  synced: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [error, setError] = useState<string | null>(null);
  const [pendingArtistId, setPendingArtistId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sortedArtists = [...userArtists].sort(comparators[sortKey]);

  function toggleIgnored(artistId: string, ignored: boolean) {
    setPendingArtistId(artistId);
    startTransition(async () => {
      const result = await setArtistIgnored(artistId, ignored);
      setError(result.error);
      setPendingArtistId(null);
    });
  }

  return (
    <div>
      {userArtists.length === 0 ? (
        // Already inside the section's bordered panel, so no dashed box here -
        // just the centered empty-state text.
        <p className="px-6 py-8 text-center text-sm text-gray-500">
          {synced
            ? "No listening history imported. If you just signed up for Last.fm, wait for Last.fm to capture future listening history."
            : "Run a sync above to import listening history."}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-xs text-gray-500 italic">
              ({numberFormat.format(userArtists.length)})
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
          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600">
            {sortedArtists.map(({ artist, interests, excluded }) => (
              <li
                key={artist.id}
                className="group flex flex-wrap items-center gap-2 text-sm"
              >
                <span
                  className={
                    excluded
                      ? "text-gray-400 line-through dark:text-gray-600"
                      : undefined
                  }
                >
                  {artist.name}
                </span>
                {interests
                  .filter((interest) => KNOWN_ARTIST_KINDS.has(interest.kind))
                  .map((interest) => (
                    <span
                      key={`${interest.kind}-${interest.source}`}
                      className={`rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700 ${
                        excluded ? "opacity-60" : ""
                      }`}
                    >
                      {interestLabel(interest)}
                    </span>
                  ))}
                <button
                  type="button"
                  onClick={() => toggleIgnored(artist.id, !excluded)}
                  disabled={pendingArtistId === artist.id}
                  title={excluded ? "Stop ignoring" : "Ignore artist"}
                  aria-label={
                    excluded
                      ? `Stop ignoring ${artist.name}`
                      : `Ignore ${artist.name}`
                  }
                  className={`ml-auto rounded p-1 text-gray-400 transition-opacity hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40 ${
                    excluded ? "" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <IgnoreIcon ignored={excluded} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500 italic">
            Ignored artists are not used to suggest artists or find concerts.
          </p>
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
