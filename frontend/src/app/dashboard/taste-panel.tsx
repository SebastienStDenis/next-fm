"use client";

import { useState, useTransition } from "react";

import type { ActionState } from "./actions";
import { setArtistHidden } from "./actions";
import { KNOWN_ARTIST_KINDS } from "./artist-kinds";
import { useTransientError } from "./use-transient-error";

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

// tags and listeners are optional so a newer frontend tolerates responses
// from a backend deployed before they existed.
export type UserArtist = {
  artist: Artist;
  interests: Interest[];
  excluded: boolean;
  tags?: string[];
  listeners?: number | null;
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

function HideIcon({ hidden }: { hidden: boolean }) {
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
      {hidden ? (
        <>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="m4.9 4.9 14.2 14.2" />
        </>
      )}
    </svg>
  );
}

function ArtistRow({ userArtist }: { userArtist: UserArtist }) {
  const { artist, interests, excluded } = userArtist;
  const [result, setResult] = useState<ActionState>({ error: null });
  const error = useTransientError(result);
  const [pending, startTransition] = useTransition();

  function toggleHidden() {
    startTransition(async () => {
      setResult(await setArtistHidden(artist.id, !excluded));
    });
  }

  return (
    <li className="group flex flex-wrap items-center gap-2 text-sm">
      <span
        className={
          excluded ? "text-gray-400 line-through dark:text-gray-600" : undefined
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
      <span className="ml-auto flex items-center gap-2">
        {error && !pending && (
          <span
            key={error.key}
            className="animate-fade-in-out text-xs text-red-600"
          >
            {error.message}
          </span>
        )}
        <button
          type="button"
          onClick={toggleHidden}
          disabled={pending}
          title={excluded ? "Unhide" : "Hide artist"}
          aria-label={
            excluded ? `Unhide ${artist.name}` : `Hide ${artist.name}`
          }
          className={`rounded p-1 text-gray-400 transition-opacity hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40 ${
            // Hidden-until-hover only where hovering exists; touch devices
            // (no group-hover: Tailwind gates it behind hover: hover) always
            // show the button.
            excluded ? "" : "pointer-fine:opacity-0 group-hover:opacity-100"
          }`}
        >
          <HideIcon hidden={excluded} />
        </button>
      </span>
    </li>
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
  const sortedArtists = [...userArtists].sort(comparators[sortKey]);

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
            {sortedArtists.map((userArtist) => (
              <ArtistRow key={userArtist.artist.id} userArtist={userArtist} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500 italic">
            Hidden artists are skipped when suggesting artists and finding
            concerts.
          </p>
        </>
      )}
    </div>
  );
}
