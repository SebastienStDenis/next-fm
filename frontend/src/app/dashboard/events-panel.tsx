"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Pencil, Undo2, X } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import type { City } from "./city-panel";
import { CitySearchBox } from "./city-search-box";
import { InlineNav } from "../inline-nav";
import { EmptyState } from "./empty-state";
import { RunSyncMessage } from "./run-sync-message";

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
const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function placeLabel(event: UserEvent["event"]): string {
  return [event.city_name, event.region].filter(Boolean).join(", ");
}

export type ArtistRelation = "known" | "suggested";

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

export function EventsPanel({
  city,
  synced,
  artistRelations,
  events,
}: {
  city: City | null;
  synced: boolean;
  artistRelations: Record<string, ArtistRelation>;
  events: UserEvent[];
}) {
  const [showSuggested, setShowSuggested] = useState(true);
  const [showKnown, setShowKnown] = useState(false);
  const [viewCity, setViewCity] = useState<City | null>(null);
  const [viewEvents, setViewEvents] = useState<UserEvent[]>([]);
  const [editingCity, setEditingCity] = useState(false);
  const [loading, startTransition] = useTransition();

  if (!synced) {
    return <RunSyncMessage action="find concerts" />;
  }

  function selectCity(selected: City) {
    // Picking the home city is a return home, not a city view - the home
    // events are already loaded and the back control should disappear.
    if (city && selected.geonameid === city.geonameid) {
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
          autoFocus
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
        {shownCity && <span className="min-w-0">{shownCity.name}</span>}
        <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
      </Button>
      {viewCity && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setViewCity(null)}
          aria-label={city ? `Back to ${city.name}` : "Back"}
          title={city ? `Back to ${city.name}` : "Back"}
          className="text-muted-foreground"
        >
          <Undo2 aria-hidden />
        </Button>
      )}
    </span>
  );

  return (
    <div>
      {!city && !viewCity ? (
        <div>
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
            <span>Upcoming concerts in</span>
            {cityField}
          </h3>
          <EmptyState className="mt-4">
            Set your home city in{" "}
            <InlineNav href="/dashboard/account">Account</InlineNav> to see
            local concerts.
          </EmptyState>
        </div>
      ) : (
        <>
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
          {visibleEvents.length === 0 ? (
            hiddenCount === 0 && (
              <EmptyState className="mt-4">
                {viewCity
                  ? "No concerts found. Try a different city."
                  : `No concerts found near ${city?.name}.`}
              </EmptyState>
            )
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleEvents.map(({ event, url, artists }) => (
                <li key={event.id} className="flex">
                  <Card size="sm" className="flex-1">
                    <CardHeader>
                      {/* gap-y-1 matches the header gap, so a wrapped date
                          sits as close to the title above as to the venue
                          line below. */}
                      <CardTitle className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                        <span className="min-w-0">
                          {event.title ??
                            artists.map((artist) => artist.name).join(", ")}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {dateFormat.format(new Date(event.starts_at))}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        {event.venue_name} · {placeLabel(event)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto flex flex-wrap items-center gap-2">
                      {artists.map((artist) => {
                        const suggested =
                          artistRelations[artist.id] === "suggested";
                        return (
                          <Badge
                            key={artist.id}
                            variant={suggested ? "secondary" : "outline"}
                            className={`max-w-full font-normal ${suggested ? "" : "text-muted-foreground"}`}
                          >
                            <span className="truncate">
                              {artistChipLabel(artist, artistRelations)}
                            </span>
                          </Badge>
                        );
                      })}
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
              ))}
            </ul>
          )}
          {hiddenCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              {hiddenCount} {hiddenCount === 1 ? "concert is" : "concerts are"}{" "}
              hidden by filters.
            </p>
          )}
        </>
      )}
    </div>
  );
}
