"use client";

import { useState, useTransition } from "react";
import { ExternalLink, MapPin, Pencil, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  usePinnedPopoverWidth,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { hasVirtualKeyboard } from "@/lib/utils";
import { AnimatedHeight } from "./animated-height";
import { KNOWN_ARTIST_KINDS } from "./artist-kinds";
import {
  ArtistDetails,
  KnownInterestBadges,
  ScoreBadge,
  scoreOf,
} from "./artist-details";
import type { City } from "./city-panel";
import { CitySearchBox } from "./city-search-box";
import { EmptyState, EmptyStateCell } from "./empty-state";
import { RunSyncMessage } from "./run-sync-message";
import { SortSelect, type SortOption } from "./sort-select";
import type { UserArtist } from "./taste-panel";

export type UserEvent = {
  event: {
    id: string;
    title: string | null;
    venue_name: string;
    venue_latitude: number;
    venue_longitude: number;
    city_name: string;
    region: string | null;
    country: string | null;
    starts_at: string;
  };
  url: string | null;
  distance_km: number;
  artists: { id: string; name: string }[];
};

// Event times are stored as venue-local time labeled UTC, so formatting in
// UTC displays the original local time. Day and time are formatted apart
// because the card stacks them on separate lines.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function placeLabel(event: UserEvent["event"]): string {
  return [event.city_name, event.region].filter(Boolean).join(", ");
}

// A title that only repeats the venue name is not a title - Bandsintown
// listings are often named after their venue ("Public Records") - so the
// heading falls back to the artists and the venue keeps its slot.
// Compared trimmed: Bandsintown strings carry stray whitespace
// ("Moda Center "). Shared with the artist cards' concerts popover so
// both surfaces agree on which titles are real.
export function eventTitle(event: UserEvent["event"]): string | null {
  return event.title && event.title.trim() !== event.venue_name.trim()
    ? event.title
    : null;
}

// Sorting by name uses the same name the card displays as its heading.
function eventName(userEvent: UserEvent): string {
  return (
    eventTitle(userEvent.event) ??
    userEvent.artists.map((artist) => artist.name).join(", ")
  );
}

export type ArtistRelation = "known" | "suggested";

type SortKey = "date" | "name" | "match";

const sortOptions: readonly SortOption<SortKey>[] = [
  { value: "date", label: "Date" },
  { value: "name", label: "Name" },
  { value: "match", label: "Best match" },
];

function byName(a: UserEvent, b: UserEvent): number {
  return eventName(a).localeCompare(eventName(b));
}

// Best match puts concerts featuring an artist you already listen to first,
// then ranks by the summed suggestion score of every artist on the bill.
// Known is judged by known-kind interests rather than the relation map: an
// artist can be both known and suggested, and the map keeps only one side.
// The sum counts only artists currently surfaced as suggestions: a hidden
// artist's lingering suggestion interest shouldn't lift its concerts.
function makeComparators(
  relations: Record<string, ArtistRelation>,
  artistsById: Record<string, UserArtist>,
): Record<SortKey, (a: UserEvent, b: UserEvent) => number> {
  const hasKnown = (userEvent: UserEvent) =>
    userEvent.artists.some((artist) =>
      artistsById[artist.id]?.interests.some((interest) =>
        KNOWN_ARTIST_KINDS.has(interest.kind),
      ),
    );
  const scoreSum = (userEvent: UserEvent) =>
    userEvent.artists.reduce(
      (total, artist) =>
        relations[artist.id] === "suggested"
          ? total + scoreOf(artistsById[artist.id])
          : total,
      0,
    );
  return {
    // The ISO timestamps sort chronologically as strings; ties keep the
    // server's starts_at,id order so the list agrees with the artist cards'
    // concert footers.
    date: (a, b) =>
      a.event.starts_at.localeCompare(b.event.starts_at) ||
      a.event.id.localeCompare(b.event.id),
    name: byName,
    match: (a, b) =>
      Number(hasKnown(b)) - Number(hasKnown(a)) ||
      scoreSum(b) - scoreSum(a) ||
      byName(a, b),
  };
}

function artistChipLabel(
  artist: { id: string; name: string },
  relations: Record<string, ArtistRelation>,
): string {
  switch (relations[artist.id]) {
    case "suggested":
      return `you might like ${artist.name}`;
    case "known":
      return `you listen to ${artist.name}`;
    default:
      return artist.name;
  }
}

// An artist chip on a concert card. With details on hand it opens a popover
// carrying the artist's profile - the same facts their Artists-tab card
// shows - so the concert can be judged without leaving the tab.
function ArtistChip({
  artist,
  relations,
  details,
}: {
  artist: { id: string; name: string };
  relations: Record<string, ArtistRelation>;
  details?: UserArtist;
}) {
  const { triggerRef, open, onOpenChange, maxWidth } = usePinnedPopoverWidth();
  const suggested = relations[artist.id] === "suggested";
  const label = (
    <>
      {/* Suggestions carry the primary accent dot, echoing the score pill;
          known-artist chips stay plain. */}
      {suggested && (
        <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
      )}
      <span className="truncate">{artistChipLabel(artist, relations)}</span>
    </>
  );
  // pl-1.5 sets the dot concentric with the pill's rounded end, matching the
  // score pill's px-1.5.
  const badgeClass = `max-w-full font-normal text-muted-foreground ${
    suggested ? "pl-1.5" : ""
  }`;
  const variant = suggested ? "accent" : "outline";

  if (!details) {
    return (
      <Badge variant={variant} className={badgeClass}>
        {label}
      </Badge>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Badge
          asChild
          variant={variant}
          className={`${badgeClass} cursor-pointer ${
            suggested
              ? "hover:bg-primary/8 dark:hover:bg-primary/12"
              : "hover:bg-muted"
          }`}
        >
          <button ref={triggerRef} type="button" title={`About ${artist.name}`}>
            {label}
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" style={{ maxWidth }}>
        <PopoverHeader>
          {/* The artist's headline number rides the title row: the score for
              a suggestion, the listening-history pills for an artist you
              listen to. Mirrors the Artists-tab card title row: the row
              never wraps, a long name wraps beside the in-line badge, and
              items-start keeps the badge on the first line. */}
          <PopoverTitle className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words">{artist.name}</span>
            {suggested ? (
              <ScoreBadge userArtist={details} />
            ) : (
              <KnownInterestBadges userArtist={details} className="justify-end" />
            )}
          </PopoverTitle>
        </PopoverHeader>
        {/* gap-1 and the tags' pt-2 mirror the Artists-tab card body, so the
            popover reads as the same card in miniature. */}
        <div className="flex flex-col gap-1">
          <ArtistDetails
            userArtist={details}
            showKnownInterests={suggested}
            tagsClassName="pt-2"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EventsPanel({
  city,
  synced,
  artistRelations,
  artistsById,
  events,
}: {
  city: City;
  synced: boolean;
  artistRelations: Record<string, ArtistRelation>;
  artistsById: Record<string, UserArtist>;
  events: UserEvent[];
}) {
  const [showSuggested, setShowSuggested] = useState(true);
  const [showKnown, setShowKnown] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [viewCity, setViewCity] = useState<City | null>(null);
  const [viewEvents, setViewEvents] = useState<UserEvent[]>([]);
  const [editingCity, setEditingCity] = useState(false);
  const [loading, startTransition] = useTransition();

  // Existing data always shows (even if the latest run didn't complete the
  // events step); the run-a-sync hint is only for a truly empty panel.
  if (events.length === 0 && !synced) {
    return <RunSyncMessage action="find concerts" />;
  }

  function selectCity(selected: City) {
    // Picking the home city is a return home, not a city view - the home
    // events are already loaded and the back control should disappear.
    if (selected.geonameid === city.geonameid) {
      setViewCity(null);
      setEditingCity(false);
      return;
    }
    startTransition(async () => {
      const res = await fetch(
        `/api/me/events?geonameid=${selected.geonameid}`,
      );
      if (!res.ok) {
        toast.error("Failed to load concerts for that city.");
        return;
      }
      setViewEvents(await res.json());
      setViewCity(selected);
      setEditingCity(false);
    });
  }

  // Events come with known artists included regardless of the user's global
  // setting; the filter toggles below only affect this view.
  const shownEvents = viewCity ? viewEvents : events;
  const visibleEvents = shownEvents
    .filter((userEvent) =>
      userEvent.artists.some((artist) => {
        const relation = artistRelations[artist.id];
        return (
          (showSuggested && relation === "suggested") ||
          (showKnown && relation === "known")
        );
      }),
    )
    .sort(makeComparators(artistRelations, artistsById)[sortKey]);
  const hiddenCount = shownEvents.length - visibleEvents.length;

  const shownCity = viewCity ?? city;
  // The city name in the title is the switcher: click it (or its pencil) to
  // swap in a search input; picking from the dropdown accepts, the X cancels.
  // While viewing another city, an undo arrow jumps back to the home city.
  const cityField = editingCity ? (
    <span className="flex items-center gap-2">
      <span className="w-56 max-w-full font-normal">
        <CitySearchBox
          placeholder="Search for a city"
          disabled={loading}
          autoFocus={!hasVirtualKeyboard()}
          onSelect={selectCity}
        />
      </span>
      {loading ? (
        <span className="flex text-muted-foreground">
          <Spinner />
        </span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditingCity(false)}
          aria-label="Cancel"
          title="Cancel"
          className="text-muted-foreground"
        >
          <X aria-hidden />
        </Button>
      )}
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setEditingCity(true)}
        title="See concerts in another city"
        className="-mx-2 -my-1 h-auto min-w-0 gap-1.5 px-2 py-1 text-base font-semibold"
      >
        <span className="min-w-0">{shownCity.name}</span>
        <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
      </Button>
      {viewCity && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setViewCity(null)}
          aria-label={`Back to ${city.name}`}
          title={`Back to ${city.name}`}
          className="text-muted-foreground"
        >
          <Undo2 aria-hidden />
        </Button>
      )}
    </span>
  );

  return (
    <div>
      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
        <span>Upcoming concerts in</span>
        {cityField}
        <span>({visibleEvents.length})</span>
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-2">
          <Toggle
            variant="outline"
            size="sm"
            pressed={showSuggested}
            onPressedChange={setShowSuggested}
          >
            Suggested artists
          </Toggle>
          <Toggle
            variant="outline"
            size="sm"
            pressed={showKnown}
            onPressedChange={setShowKnown}
          >
            Artists you listen to
          </Toggle>
        </div>
        {/* ml-auto rather than justify-between on the row: it also keeps the
            picker right-aligned when it wraps to its own line. */}
        <SortSelect
          value={sortKey}
          onValueChange={setSortKey}
          options={sortOptions}
          className="ml-auto"
        />
      </div>
      <div className="mt-3">
        <AnimatedHeight>
          {visibleEvents.length === 0 && hiddenCount === 0 ? (
            <EmptyStateCell>
              {viewCity
                ? "No concerts found. Try a different city."
                : `No concerts found near ${city.name}. NextFM will find new concerts as they're announced.`}
            </EmptyStateCell>
          ) : (
            <ul className="grid grid-cols-[minmax(0,26rem)] gap-3 sm:grid-cols-[repeat(2,minmax(0,26rem))] lg:grid-cols-3">
              {visibleEvents.map((userEvent) => {
                const { event, url, artists } = userEvent;
                const startsAt = new Date(event.starts_at);
                return (
                  <li key={event.id} className="flex">
                    <Card size="sm" className="flex-1">
                      {/* gap-2 rather than the artist cards' gap-3: the date
                          stack already extends below a one-line title, so a
                          full gap-3 would push the venue line farther from
                          the title than the artist cards' body sits. */}
                      <CardHeader className="gap-2">
                        {/* The date always stacks day over time in a fixed
                            right-hand column (shrink-0), keeping it beside
                            the title; the title takes the remaining width
                            and wraps within its slot only when it must. */}
                        <CardTitle className="flex items-baseline gap-x-2">
                          <span className="min-w-0 text-balance">
                            {eventName(userEvent)}
                          </span>
                          <span className="ml-auto shrink-0 text-right text-xs font-normal text-muted-foreground">
                            <span className="block">
                              {dateFormat.format(startsAt)}
                            </span>
                            {timeFormat.format(startsAt)}
                          </span>
                        </CardTitle>
                        {/* text-xs steps the venue line below the title,
                            matching the date and the Tickets link. */}
                        <CardDescription className="flex items-start gap-1 text-xs">
                          {/* mt-px centers the 14px icon in the 16px first
                              line, so it holds position if the text wraps. */}
                          <MapPin
                            className="mt-px size-3.5 shrink-0"
                            aria-hidden
                          />
                          <span className="min-w-0">
                            {event.venue_name} · {placeLabel(event)}
                          </span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="mt-auto flex flex-wrap items-center gap-2">
                        {artists.map((artist) => (
                          <ArtistChip
                            key={artist.id}
                            artist={artist}
                            relations={artistRelations}
                            details={artistsById[artist.id]}
                          />
                        ))}
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Tickets
                            <ExternalLink className="size-3.5" aria-hidden />
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
              {/* Filtered-out concerts keep a slot in the grid: a ghost cell
              sized like the cards it stands in for. */}
              {hiddenCount > 0 && (
                <li className="flex">
                  <EmptyState className="flex-1 content-center">
                    {hiddenCount} {hiddenCount === 1 ? "concert" : "concerts"}{" "}
                    hidden by filters.
                  </EmptyState>
                </li>
              )}
            </ul>
          )}
        </AnimatedHeight>
      </div>
    </div>
  );
}
