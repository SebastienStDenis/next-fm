"use client";

import Link from "next/link";
import { useState } from "react";

import { SIMILAR_ARTIST_KIND } from "./artist-kinds";

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
  if (interest.kind === SIMILAR_ARTIST_KIND) {
    // A known artist can briefly hold a suggestion row too (the show-grace
    // window); label it rather than showing the raw kind.
    return `suggested · score ${(interest.weight ?? 0).toFixed(2)}`;
  }
  return interest.kind;
}

export function ArtistsPanel({
  lastfmLinked,
  userArtists,
  allArtists,
}: {
  lastfmLinked: boolean;
  userArtists: UserArtist[];
  allArtists: Artist[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const sortedArtists = [...userArtists].sort(comparators[sortKey]);

  return (
    <div>
      {!lastfmLinked && (
        <p className="text-sm text-gray-500">
          Link a Last.fm account to sync artists.
        </p>
      )}

      {userArtists.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No artists synced yet.</p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Synced artists ({numberFormat.format(userArtists.length)})
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
          <ul className="mt-2 space-y-1">
            {sortedArtists.map(({ artist, interests }) => (
              <li
                key={artist.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span>{artist.name}</span>
                {interests.map((interest) => (
                  <span
                    key={`${interest.kind}-${interest.source}`}
                    className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700"
                  >
                    {interestLabel(interest)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-medium">
          <Link href="/artists" className="hover:underline">
            All artists ({numberFormat.format(allArtists.length)}) &rarr;
          </Link>
        </h3>
        {allArtists.length === 0 ? (
          <p className="text-sm text-gray-500">No artists in the registry.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded border border-gray-300 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">
            {allArtists.map((artist) => (
              <li key={artist.id}>{artist.name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
