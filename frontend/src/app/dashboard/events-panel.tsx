"use client";

import { useState, useTransition } from "react";
import { Pencil, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import { hasVirtualKeyboard } from "@/lib/utils";
import { AnimatedHeight } from "./animated-height";
import type { City } from "./city-panel";
import { CitySearchBox } from "./city-search-box";
import { ConcertCard } from "./concert-card";
import { ConcertDialog } from "./concert-dialog";
import { EmptyState, EmptyStateCell } from "./empty-state";
import { RunSyncMessage } from "./run-sync-message";
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
// UTC displays the original local time.
export const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function placeLabel(event: UserEvent["event"]): string {
  return [event.city_name, event.region].filter(Boolean).join(", ");
}

export type ArtistRelation = "known" | "suggested";

export function artistChipLabel(
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
  const [viewCity, setViewCity] = useState<City | null>(null);
  const [viewEvents, setViewEvents] = useState<UserEvent[]>([]);
  const [editingCity, setEditingCity] = useState(false);
  const [loading, startTransition] = useTransition();
  const [selectedEvent, setSelectedEvent] = useState<UserEvent | null>(null);

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
  const visibleEvents = shownEvents.filter((userEvent) =>
    userEvent.artists.some((artist) => {
      const relation = artistRelations[artist.id];
      return (
        (showSuggested && relation === "suggested") ||
        (showKnown && relation === "known")
      );
    }),
  );
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
      <div className="mt-3 flex flex-wrap gap-2">
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
      <div className="mt-3">
        <AnimatedHeight>
          {visibleEvents.length === 0 && hiddenCount === 0 ? (
            <EmptyStateCell>
              {viewCity
                ? "No concerts found. Try a different city."
                : `No concerts found near ${city.name}. NextFM will find new concerts as they're announced.`}
            </EmptyStateCell>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleEvents.map((userEvent) => (
                <li key={userEvent.event.id} className="flex">
                  {/* The card itself is the click target (opens the artist
                      popup below); the ticket link stops the click from
                      bubbling to it so it still navigates on its own. */}
                  <ConcertCard
                    userEvent={userEvent}
                    artistRelations={artistRelations}
                    onClick={() => setSelectedEvent(userEvent)}
                  />
                </li>
              ))}
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
      <ConcertDialog
        event={selectedEvent}
        artistRelations={artistRelations}
        artistsById={artistsById}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEvent(null);
          }
        }}
      />
    </div>
  );
}
