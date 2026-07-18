"use client";

import { useState } from "react";

import { ArtistCard, scoreOf } from "./artist-card";
import { ArtistDialog } from "./artist-dialog";
import type { City } from "./city-panel";
import { EmptyStateCell } from "./empty-state";
import type { ArtistRelation, UserEvent } from "./events-panel";
import { RunSyncMessage } from "./run-sync-message";
import type { UserArtist } from "./taste-panel";

export function SuggestedArtistsPanel({
  suggestedArtists,
  synced,
  artistRelations,
  homeCity,
  homeEvents,
  pinnedCities,
}: {
  suggestedArtists: UserArtist[];
  synced: boolean;
  artistRelations: Record<string, ArtistRelation>;
  homeCity: City;
  homeEvents: UserEvent[];
  pinnedCities: City[];
}) {
  const sortedArtists = [...suggestedArtists].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) || a.artist.name.localeCompare(b.artist.name),
  );
  const [selected, setSelected] = useState<UserArtist | null>(null);

  return (
    <div>
      {suggestedArtists.length === 0 ? (
        synced ? (
          <EmptyStateCell>
            No artists suggested. If you just signed up for Last.fm, wait for
            Last.fm to capture future listening history. NextFM will suggest
            new artists as your listening history changes.
          </EmptyStateCell>
        ) : (
          <RunSyncMessage action="suggest artists" />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedArtists.map((userArtist) => (
            <li key={userArtist.artist.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setSelected(userArtist)}
                className="block h-full w-full min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <ArtistCard
                  userArtist={userArtist}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ArtistDialog
        userArtist={selected}
        artistRelations={artistRelations}
        homeCity={homeCity}
        homeEvents={homeEvents}
        pinnedCities={pinnedCities}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
      />
    </div>
  );
}
