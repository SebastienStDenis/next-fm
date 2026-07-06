"use client";

import { useActionState } from "react";

import { syncSuggestions } from "./actions";
import { SIMILAR_ARTIST_KIND } from "./artist-kinds";
import type { Interest, UserArtist } from "./artists-panel";

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
  lastfmLinked,
  suggestedArtists,
}: {
  userId: string;
  lastfmLinked: boolean;
  suggestedArtists: UserArtist[];
}) {
  const [state, formAction, pending] = useActionState(
    syncSuggestions.bind(null, userId),
    { error: null, summary: null },
  );
  const sortedArtists = [...suggestedArtists].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || a.artist.name.localeCompare(b.artist.name),
  );

  return (
    <div>
      {lastfmLinked ? (
        <div className="space-y-2">
          <form action={formAction}>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
            >
              {pending ? "Syncing... (this can take a while)" : "Sync suggestions"}
            </button>
          </form>
          {state.summary && <p className="text-sm text-gray-500">{state.summary}</p>}
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Link a Last.fm account to get suggestions.
        </p>
      )}

      {suggestedArtists.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No suggestions yet. Sync to discover artists similar to the ones you
          listen to - concerts and playlists are built from these.
        </p>
      ) : (
        <>
          <h3 className="mt-4 text-sm font-medium">
            Suggested artists ({suggestedArtists.length})
          </h3>
          <ul className="mt-2 space-y-1">
            {sortedArtists.map((userArtist) => (
              <li
                key={userArtist.artist.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span>{userArtist.artist.name}</span>
                <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700">
                  score {scoreOf(userArtist).toFixed(2)}
                </span>
                {reasonOf(userArtist) && (
                  <span className="text-xs text-gray-500">
                    {reasonOf(userArtist)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
