"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ArtistCard } from "./artist-card";
import { ConcertCard } from "./concert-card";
import type { ArtistRelation, UserEvent } from "./events-panel";
import type { UserArtist } from "./taste-panel";

export function ConcertDialog({
  event,
  artistRelations,
  artistsById,
  onOpenChange,
}: {
  event: UserEvent | null;
  artistRelations: Record<string, ArtistRelation>;
  artistsById: Record<string, UserArtist>;
  onOpenChange: (open: boolean) => void;
}) {
  // Keep showing the last concert while the dialog animates closed, so the
  // content doesn't blank out before the fade-out finishes.
  const [displayed, setDisplayed] = useState(event);
  useEffect(() => {
    if (event) {
      setDisplayed(event);
    }
  }, [event]);

  return (
    <Dialog open={event !== null} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-4 overflow-hidden sm:max-w-lg"
      >
        {displayed && (
          <>
            {/* The concert card below already carries the title, date and
                venue visually; this stays for the accessible name only. */}
            <DialogHeader>
              <DialogTitle className="sr-only">
                {displayed.event.title ??
                  displayed.artists.map((artist) => artist.name).join(", ")}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
              <ConcertCard
                userEvent={displayed}
                artistRelations={artistRelations}
                floating
              />
              <section>
                <h4 className="text-sm font-semibold">Artists</h4>
                <ul className="mt-2 grid gap-3 sm:grid-cols-2">
                  {displayed.artists.map((artist) => {
                    const userArtist = artistsById[artist.id];
                    return (
                      <li key={artist.id}>
                        {userArtist ? (
                          <ArtistCard
                            userArtist={userArtist}
                            relation={artistRelations[artist.id]}
                            floating
                          />
                        ) : (
                          <div className="rounded-xl px-3 py-2 text-sm ring-1 ring-foreground/10">
                            {artist.name}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
