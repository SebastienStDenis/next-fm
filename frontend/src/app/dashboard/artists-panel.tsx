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
import type { City, UserArtist, UserEvent } from "@/lib/api-types";

import { AnimatedHeight } from "@/components/animated-height";
import {
  DISPLAY_TITLE_CLASS,
  TITLE_RIDER_CLASS,
} from "@/components/display-title";
import { cn } from "@/lib/utils";
import {
  ArtistDetails,
  KnownInterestBadges,
  ScoreBadge,
} from "./artist-details";
import {
  CARD_GRID_CLASS,
  EmptyState,
  EmptyStateCell,
  HiddenByFiltersCell,
} from "./empty-state";
import { eventTitle } from "./event-sort";
import { concertDateFormat } from "@/lib/formats";
import { RelationFilterBar } from "./relation-filter-bar";
import { RunSyncText } from "./run-sync-message";
import { type SortOption } from "./sort-select";
import { compareByName, playsOf, rankOf, scoreOf } from "./user-artist";
import { usePinnedPopoverWidth } from "./use-pinned-popover-width";

// The concerts matched near one of the user's cities (home or pinned),
// keyed by that city so the footer popover can group by it - the venue's
// own city name means little for a pinned city's surroundings.
export type CityConcerts = {
  city: City;
  events: UserEvent[];
};

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
  sections: CityConcerts[];
  multiCity: boolean;
}) {
  const { triggerRef, open, onOpenChange, maxWidth } = usePinnedPopoverWidth();
  // One concert can sit within range of two of the user's cities and
  // appear in both sections; the count stays honest by counting events.
  const count = new Set(
    sections.flatMap(({ events }) => events.map(({ event }) => event.id)),
  ).size;
  return (
    <CardFooter className="p-0">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          ref={triggerRef}
          className="flex flex-1 cursor-pointer items-center gap-1.5 px-(--card-spacing) py-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 [&[data-state=open]>svg:last-of-type]:rotate-180"
        >
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
        <PopoverContent align="start" style={{ maxWidth }}>
          <PopoverHeader>
            <PopoverTitle>Upcoming Concerts</PopoverTitle>
          </PopoverHeader>
          {multiCity ? (
            sections.map(({ city, events }) => (
              <div key={city.geonameid} className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">{city.name}</p>
                <ConcertList concerts={events} />
              </div>
            ))
          ) : (
            <ConcertList concerts={sections[0].events} />
          )}
        </PopoverContent>
      </Popover>
    </CardFooter>
  );
}

type SortKey = "match" | "name" | "concert";

const sortOptions: readonly SortOption<SortKey>[] = [
  { value: "match", label: "Best match" },
  { value: "name", label: "Name" },
  { value: "concert", label: "Next concert" },
];

// Next concert orders by each artist's soonest show across the user's
// cities; artists with nothing coming up trail alphabetically. Best match
// leads with the you-listen-to cards in the Listening History panel's
// plays order (Last.fm's play-based top-artist rank, raw playcount for
// the unranked), then ranks suggestion cards by score. Each card sorts by
// the signal it displays: an artist with both listening history and a
// suggestion renders as a suggestion, so only its score counts.
function makeComparators(
  suggestedIds: Set<string>,
  soonestConcert: Map<string, string>,
): Record<SortKey, (a: UserArtist, b: UserArtist) => number> {
  return {
    match: (a, b) => {
      const aSuggested = suggestedIds.has(a.artist.id);
      const bSuggested = suggestedIds.has(b.artist.id);
      if (aSuggested !== bSuggested) {
        return aSuggested ? 1 : -1;
      }
      return aSuggested
        ? scoreOf(b) - scoreOf(a) || compareByName(a, b)
        : rankOf(a) - rankOf(b) ||
            playsOf(b) - playsOf(a) ||
            compareByName(a, b);
    },
    name: compareByName,
    concert: (a, b) => {
      const aDate = soonestConcert.get(a.artist.id);
      const bDate = soonestConcert.get(b.artist.id);
      if (aDate && bDate) {
        return aDate.localeCompare(bDate) || compareByName(a, b);
      }
      if (aDate || bDate) {
        return aDate ? -1 : 1;
      }
      return compareByName(a, b);
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

// Why the suggestions half of the panel is empty: the sync hasn't produced
// them yet, or it ran and found none (see docs/wording.md).
function NoSuggestionsMessage({ synced }: { synced: boolean }) {
  return synced ? (
    <>
      No artists suggested. If you just signed up for Last.fm, wait for
      Last.fm to capture future listening history. NextFM will suggest new
      artists as your listening history changes.
    </>
  ) : (
    <RunSyncText action="suggest artists" />
  );
}

export function ArtistsPanel({
  suggestedArtists,
  knownArtists,
  cityConcerts,
  synced,
}: {
  suggestedArtists: UserArtist[];
  // The you-listen-to side of the view: known artists not already surfaced
  // as suggestions and not hidden by the user.
  knownArtists: UserArtist[];
  cityConcerts: CityConcerts[];
  synced: boolean;
}) {
  const [showSuggested, setShowSuggested] = useState(true);
  const [showKnown, setShowKnown] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("match");

  // Without any artist to show there is nothing to filter or sort: just the
  // explanation, full width, in place of the controls.
  if (suggestedArtists.length === 0 && knownArtists.length === 0) {
    return (
      <EmptyStateCell>
        <NoSuggestionsMessage synced={synced} />
      </EmptyStateCell>
    );
  }

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
  const suggestedIds = new Set(
    suggestedArtists.map(({ artist }) => artist.id),
  );
  const visibleArtists = [
    ...(showSuggested ? suggestedArtists : []),
    ...(showKnown ? knownArtists : []),
  ].sort(makeComparators(suggestedIds, soonestConcert)[sortKey]);
  const hiddenCount =
    suggestedArtists.length + knownArtists.length - visibleArtists.length;

  return (
    <div>
      <RelationFilterBar
        showSuggested={showSuggested}
        onShowSuggested={setShowSuggested}
        showKnown={showKnown}
        onShowKnown={setShowKnown}
        sortKey={sortKey}
        onSortKey={setSortKey}
        sortOptions={sortOptions}
        className="mb-3"
      />
      <AnimatedHeight>
        <ul className={CARD_GRID_CLASS}>
          {visibleArtists.map((userArtist) => {
            const suggested = suggestedIds.has(userArtist.artist.id);
            const sections = cityConcerts
              .map(({ city }, index) => ({
                city,
                events: cityIndexes[index].get(userArtist.artist.id) ?? [],
              }))
              .filter((section) => section.events.length > 0);
            return (
              <li key={userArtist.artist.id} className="min-w-0">
                <Card size="sm" className="h-full gap-2">
                  {/* items-start rides the badge on the title's first line
                      when a long name wraps. */}
                  <CardHeader className="flex items-start justify-between gap-2">
                    <CardTitle
                      className={cn("min-w-0 break-words", DISPLAY_TITLE_CLASS)}
                    >
                      {userArtist.artist.name}
                    </CardTitle>
                    {/* The artist's headline number: the score for a
                        suggestion, the listening-history pills for an artist
                        you listen to - matching the concert chips' popover. */}
                    <span className={TITLE_RIDER_CLASS}>
                      {suggested ? (
                        <ScoreBadge userArtist={userArtist} />
                      ) : (
                        <KnownInterestBadges
                          userArtist={userArtist}
                          className="justify-end"
                        />
                      )}
                    </span>
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
          {/* The tab's headline content is suggestions: when the filter asks
              for them and there are none, the explanation keeps its slot even
              while you-listen-to cards fill the rest of the grid. */}
          {showSuggested && suggestedArtists.length === 0 && (
            <li className="flex">
              <EmptyState className="flex-1 content-center">
                <NoSuggestionsMessage synced={synced} />
              </EmptyState>
            </li>
          )}
          {hiddenCount > 0 && (
            <HiddenByFiltersCell count={hiddenCount} noun="artist" />
          )}
        </ul>
      </AnimatedHeight>
    </div>
  );
}
