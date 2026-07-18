"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, ExternalLink } from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

import { ArtistDetails, ScoreBadge, scoreOf } from "./artist-details";
import type { City } from "./city-panel";
import { EmptyStateCell } from "./empty-state";
import { eventTitle, type UserEvent } from "./events-panel";
import { RunSyncMessage } from "./run-sync-message";
import { SortSelect, type SortOption } from "./sort-select";
import type { UserArtist } from "./taste-panel";

// The concerts matched near one of the user's cities (home or pinned),
// keyed by that city so the footer popover can group by it - the venue's
// own city name means little for a pinned city's surroundings.
export type CityConcerts = {
  city: City;
  events: UserEvent[];
};

// Event times are stored as venue-local time labeled UTC, so formatting in
// UTC displays the original local time.
const concertDateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function ConcertList({ concerts }: { concerts: UserEvent[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-xs">
      {concerts.map(({ event, url }) => {
        const show = [eventTitle(event), event.venue_name]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={event.id}>
            <span className="font-medium">
              {concertDateFormat.format(new Date(event.starts_at))}
            </span>
            <span className="text-muted-foreground"> · </span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground underline hover:text-foreground"
              >
                {show}
                <ExternalLink
                  className="ml-1 inline size-3 -translate-y-px"
                  aria-hidden
                />
              </a>
            ) : (
              <span className="text-muted-foreground">{show}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ConcertsFooter({
  sections,
  multiCity,
}: {
  sections: { city: City; concerts: UserEvent[] }[];
  multiCity: boolean;
}) {
  // One concert can sit within range of two of the user's cities and
  // appear in both sections; the count stays honest by counting events.
  const count = new Set(
    sections.flatMap(({ concerts }) => concerts.map(({ event }) => event.id)),
  ).size;
  return (
    <CardFooter className="p-0">
      <Popover>
        <PopoverTrigger className="flex flex-1 cursor-pointer items-center gap-1.5 px-(--card-spacing) py-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 [&[data-state=open]>svg:last-of-type]:rotate-180">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 text-left">
            {count} upcoming {count === 1 ? "concert" : "concerts"} near{" "}
            {multiCity ? "your cities" : "you"}
          </span>
          <ChevronDown
            className="ml-auto size-3.5 shrink-0 transition-transform"
            aria-hidden
          />
        </PopoverTrigger>
        <PopoverContent align="start">
          <PopoverHeader>
            <PopoverTitle>Upcoming Concerts</PopoverTitle>
          </PopoverHeader>
          {multiCity ? (
            sections.map(({ city, concerts }) => (
              <div key={city.geonameid} className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">{city.name}</p>
                <ConcertList concerts={concerts} />
              </div>
            ))
          ) : (
            <ConcertList concerts={sections[0].concerts} />
          )}
        </PopoverContent>
      </Popover>
    </CardFooter>
  );
}

function byName(a: UserArtist, b: UserArtist): number {
  return a.artist.name.localeCompare(b.artist.name);
}

type SortKey = "score" | "name" | "concert";

const sortOptions: readonly SortOption<SortKey>[] = [
  { value: "score", label: "Score" },
  { value: "name", label: "Name" },
  { value: "concert", label: "Next concert" },
];

// Next concert orders by each artist's soonest show across the user's
// cities; artists with nothing coming up trail alphabetically.
function makeComparators(
  soonestConcert: Map<string, string>,
): Record<SortKey, (a: UserArtist, b: UserArtist) => number> {
  return {
    score: (a, b) => scoreOf(b) - scoreOf(a) || byName(a, b),
    name: byName,
    concert: (a, b) => {
      const aDate = soonestConcert.get(a.artist.id);
      const bDate = soonestConcert.get(b.artist.id);
      if (aDate && bDate) {
        return aDate.localeCompare(bDate) || byName(a, b);
      }
      if (aDate || bDate) {
        return aDate ? -1 : 1;
      }
      return byName(a, b);
    },
  };
}

// Each artist's upcoming concerts, soonest first (the ISO timestamps sort
// chronologically as strings).
function concertsByArtist(events: UserEvent[]): Map<string, UserEvent[]> {
  const byArtist = new Map<string, UserEvent[]>();
  const ordered = [...events].sort((a, b) =>
    a.event.starts_at.localeCompare(b.event.starts_at),
  );
  for (const userEvent of ordered) {
    for (const artist of userEvent.artists) {
      const list = byArtist.get(artist.id);
      if (list) {
        list.push(userEvent);
      } else {
        byArtist.set(artist.id, [userEvent]);
      }
    }
  }
  return byArtist;
}

export function SuggestedArtistsPanel({
  suggestedArtists,
  cityConcerts,
  synced,
}: {
  suggestedArtists: UserArtist[];
  cityConcerts: CityConcerts[];
  synced: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("score");

  const multiCity = cityConcerts.length > 1;
  const cityIndexes = cityConcerts.map(({ events }) => concertsByArtist(events));

  // Each artist's soonest show across all cities (the per-city lists are
  // already soonest-first, so the head of each is that city's earliest).
  const soonestConcert = new Map<string, string>();
  for (const index of cityIndexes) {
    for (const [artistId, concerts] of index) {
      const soonest = concerts[0].event.starts_at;
      const current = soonestConcert.get(artistId);
      if (!current || soonest < current) {
        soonestConcert.set(artistId, soonest);
      }
    }
  }
  const sortedArtists = [...suggestedArtists].sort(
    makeComparators(soonestConcert)[sortKey],
  );

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
        <>
          <div className="mb-3 flex justify-end">
            <SortSelect
              value={sortKey}
              onValueChange={setSortKey}
              options={sortOptions}
            />
          </div>
          <ul className="grid grid-cols-[minmax(0,26rem)] gap-3 sm:grid-cols-[repeat(2,minmax(0,26rem))] lg:grid-cols-3">
            {sortedArtists.map((userArtist) => {
              const sections = cityConcerts
                .map(({ city }, index) => ({
                  city,
                  concerts: cityIndexes[index].get(userArtist.artist.id) ?? [],
                }))
                .filter((section) => section.concerts.length > 0);
              return (
                <li key={userArtist.artist.id} className="min-w-0">
                  <Card size="sm" className="h-full">
                    <CardHeader className="flex items-center justify-between gap-2">
                      <CardTitle className="min-w-0 break-words">
                        {userArtist.artist.name}
                      </CardTitle>
                      <ScoreBadge userArtist={userArtist} />
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-1">
                      <ArtistDetails
                        userArtist={userArtist}
                        tagsClassName="mt-auto pt-2"
                      />
                    </CardContent>
                    {sections.length > 0 && (
                      <ConcertsFooter
                        sections={sections}
                        multiCity={multiCity}
                      />
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
