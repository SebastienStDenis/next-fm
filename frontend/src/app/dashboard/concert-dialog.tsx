"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ArtistCard } from "./artist-card";
import { ConcertCard } from "./concert-card";
import {
  dateFormat,
  type ArtistRelation,
  type UserEvent,
} from "./events-panel";
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
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-4 overflow-hidden sm:max-w-lg"
      >
        {displayed && (
          <>
            {/* Title sits on the close button's line, matching the settings
                dialog header; the date that would normally sit beside the
                title on a card gets its own line below it. */}
            <DialogHeader className="flex-none gap-1">
              <div className="flex items-center gap-3">
                <DialogTitle className="min-w-0 truncate text-lg">
                  {displayed.event.title ??
                    displayed.artists.map((artist) => artist.name).join(", ")}
                </DialogTitle>
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto shrink-0 text-muted-foreground"
                  >
                    <XIcon aria-hidden />
                    <span className="sr-only">Close</span>
                  </Button>
                </DialogClose>
              </div>
              <p className="text-xs text-muted-foreground">
                {dateFormat.format(new Date(displayed.event.starts_at))}
              </p>
            </DialogHeader>
            {/* overflow-y-auto forces overflow-x to auto too, which clips
                the inner cards' ring (a box-shadow, so it renders outside
                their border box) flush against this container's edges;
                px-1/pb-1 give it room to paint on all sides, including the
                last card's bottom edge. */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-1">
              <ConcertCard
                userEvent={displayed}
                artistRelations={artistRelations}
                bare
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
