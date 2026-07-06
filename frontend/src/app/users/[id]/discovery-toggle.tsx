"use client";

import { useState, useTransition } from "react";

import { setIncludeKnownArtists } from "./actions";

export function DiscoveryToggle({
  userId,
  includeKnownArtists,
}: {
  userId: string;
  includeKnownArtists: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          defaultChecked={includeKnownArtists}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            startTransition(async () => {
              const result = await setIncludeKnownArtists(userId, next);
              setError(result.error);
            });
          }}
        />
        Include artists I know in concerts and playlists
      </label>
      <p className="mt-1 text-sm text-gray-500">
        When off, only suggested artists&apos; shows are served - discovery
        mode.
      </p>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
