"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

import { ArtistCard } from "./artist-card";
import type { City } from "./city-panel";
import { ConcertCard } from "./concert-card";
import { EmptyState } from "./empty-state";
import type { ArtistRelation, UserEvent } from "./events-panel";
import type { UserArtist } from "./taste-panel";

function eventsFor(artistId: string, events: UserEvent[]): UserEvent[] {
  return events.filter((userEvent) =>
    userEvent.artists.some((artist) => artist.id === artistId),
  );
}

function CitySection({
  city,
  home,
  artistName,
  artistRelations,
  events,
  loading,
  failed,
}: {
  city: City;
  home?: boolean;
  artistName: string;
  artistRelations: Record<string, ArtistRelation>;
  events: UserEvent[] | null;
  loading?: boolean;
  failed?: boolean;
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold">
        {city.name}
        {home && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            (Home)
          </span>
        )}
      </h4>
      <div className="mt-2">
        {loading ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Spinner />
          </div>
        ) : failed ? (
          <EmptyState>Failed to load concerts for {city.name}.</EmptyState>
        ) : events === null || events.length === 0 ? (
          <EmptyState>
            No concerts by {artistName} found near {city.name}.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {events.map((userEvent) => (
              <li key={userEvent.event.id} className="flex">
                <ConcertCard
                  userEvent={userEvent}
                  artistRelations={artistRelations}
                  floating
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// Fetches the given pinned city's concerts (the same per-city route the
// concerts tab's city switcher uses) and filters them to this artist. Mounts
// fresh each time the dialog opens (the dialog unmounts its content while
// closed), so there's no cross-open cache to keep in sync.
function PinnedCitySection({
  city,
  artistId,
  artistName,
  artistRelations,
}: {
  city: City;
  artistId: string;
  artistName: string;
  artistRelations: Record<string, ArtistRelation>;
}) {
  const [events, setEvents] = useState<UserEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/me/events?geonameid=${city.geonameid}`)
      .then((res) => (res.ok ? (res.json() as Promise<UserEvent[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) {
          setEvents(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          toast.error(`Failed to load concerts for ${city.name}.`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [city.geonameid, city.name]);

  return (
    <CitySection
      city={city}
      artistName={artistName}
      artistRelations={artistRelations}
      loading={events === null && !failed}
      failed={failed}
      events={events ? eventsFor(artistId, events) : null}
    />
  );
}

export function ArtistDialog({
  userArtist,
  artistRelations,
  homeCity,
  homeEvents,
  pinnedCities,
  onOpenChange,
}: {
  userArtist: UserArtist | null;
  artistRelations: Record<string, ArtistRelation>;
  homeCity: City;
  homeEvents: UserEvent[];
  pinnedCities: City[];
  onOpenChange: (open: boolean) => void;
}) {
  // Keep showing the last artist while the dialog animates closed, so the
  // content doesn't blank out before the fade-out finishes.
  const [displayed, setDisplayed] = useState(userArtist);
  useEffect(() => {
    if (userArtist) {
      setDisplayed(userArtist);
    }
  }, [userArtist]);

  return (
    <Dialog open={userArtist !== null} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-4rem)] flex-col gap-4 overflow-hidden sm:max-w-lg"
      >
        {displayed && (
          <>
            {/* The artist card below already carries the name visually;
                this stays for the accessible name only. */}
            <DialogHeader>
              <DialogTitle className="sr-only">
                {displayed.artist.name}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
              <ArtistCard
                userArtist={displayed}
                relation={artistRelations[displayed.artist.id]}
                floating
              />
              <CitySection
                city={homeCity}
                home
                artistName={displayed.artist.name}
                artistRelations={artistRelations}
                events={eventsFor(displayed.artist.id, homeEvents)}
              />
              {pinnedCities.map((city) => (
                <PinnedCitySection
                  key={city.geonameid}
                  city={city}
                  artistId={displayed.artist.id}
                  artistName={displayed.artist.name}
                  artistRelations={artistRelations}
                />
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
