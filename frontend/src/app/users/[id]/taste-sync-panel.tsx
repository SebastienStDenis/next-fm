"use client";

import { useActionState } from "react";

import { syncLastfmArtists } from "./actions";

export function TasteSyncPanel({
  userId,
  lastfmLinked,
}: {
  userId: string;
  lastfmLinked: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    syncLastfmArtists.bind(null, userId),
    { error: null, summary: null },
  );

  if (!lastfmLinked) {
    return (
      <p className="text-sm text-gray-500">
        Link a Last.fm account in the Account section to sync your taste.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Syncing taste from Last.fm..." : "Sync taste from Last.fm"}
        </button>
      </form>
      {state.summary && <p className="text-sm text-gray-500">{state.summary}</p>}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
