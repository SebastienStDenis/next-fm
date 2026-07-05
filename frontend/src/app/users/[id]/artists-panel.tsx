"use client";

import { useActionState } from "react";

import { syncLastfmArtists } from "./actions";

export type Artist = {
  id: string;
  name: string;
};

type Interest = {
  kind: string;
  source: string;
  evidence: {
    rank?: number | null;
    playcount?: number | null;
    period?: string;
    track_count?: number;
  };
  created_at: string;
  updated_at: string;
};

export type UserArtist = {
  artist: Artist;
  interests: Interest[];
};

const numberFormat = new Intl.NumberFormat("en-US");

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

export function ArtistsPanel({
  userId,
  lastfmLinked,
  userArtists,
  allArtists,
}: {
  userId: string;
  lastfmLinked: boolean;
  userArtists: UserArtist[];
  allArtists: Artist[];
}) {
  const [topState, topAction, topPending] = useActionState(
    syncLastfmArtists.bind(null, userId, "lastfm_top_artist"),
    { error: null, summary: null },
  );
  const [lovedState, lovedAction, lovedPending] = useActionState(
    syncLastfmArtists.bind(null, userId, "lastfm_loved_tracks"),
    { error: null, summary: null },
  );
  const summary = topState.summary ?? lovedState.summary;
  const error = topState.error ?? lovedState.error;

  return (
    <div>
      {lastfmLinked ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <form action={topAction}>
              <button
                type="submit"
                disabled={topPending}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
              >
                {topPending ? "Syncing..." : "Sync top artists"}
              </button>
            </form>
            <form action={lovedAction}>
              <button
                type="submit"
                disabled={lovedPending}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
              >
                {lovedPending ? "Syncing..." : "Sync loved tracks"}
              </button>
            </form>
          </div>
          {summary && <p className="text-sm text-gray-500">{summary}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Link a Last.fm account to sync artists.
        </p>
      )}

      {userArtists.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No artists synced yet.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {userArtists.map(({ artist, interests }) => (
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
      )}

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-medium">
          All artists ({numberFormat.format(allArtists.length)})
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
