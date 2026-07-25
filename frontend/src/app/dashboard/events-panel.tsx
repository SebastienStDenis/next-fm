"use client";

import { useState, useTransition } from "react";
import { ExternalLink, MapPin, Pencil, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { ArtistRelation, City, UserArtist, UserEvent } from "@/lib/api-types";
import { hasVirtualKeyboard } from "@/lib/utils";
import { AnimatedHeight } from "@/components/animated-height";
import { ArtistChip } from "./artist-chip";
import { CitySearchBox } from "@/components/city-search-box";
import {
  CARD_GRID_CLASS,
  EmptyStateCell,
  HiddenByFiltersCell,
} from "./empty-state";
import {
  eventName,
  makeComparators,
  sortOptions,
  type SortKey,
} from "./event-sort";
import { concertDateFormat, concertTimeFormat } from "@/lib/formats";
import { RelationFilterBar } from "./relation-filter-bar";
import { RunSyncMessage } from "./run-sync-message";

function placeLabel(event: UserEvent["event"]): string {
  return [event.city_name, event.region].filter(Boolean).join(", ");
}

// The city name in the title is the switcher: click it (or its pencil) to
// swap in a search input; picking from the dropdown accepts, the X cancels.
// While viewing another city, an undo arrow jumps back to the home city.
function CityTitleField({
  city,
  viewCity,
  editing,
  loading,
  onSelect,
  onEdit,
  onCancel,
  onBack,
}: {
  city: City;
  viewCity: City | null;
  editing: boolean;
  loading: boolean;
  onSelect: (city: City) => void;
  onEdit: () => void;
  onCancel: () => void;
  onBack: () => void;
}) {
  const shownCity = viewCity ?? city;
  return editing ? (
    <span className="flex items-center gap-2">
      <span className="w-56 max-w-full font-normal">
        <CitySearchBox
          placeholder="Search for a city"
          disabled={loading}
          autoFocus={!hasVirtualKeyboard()}
          onSelect={onSelect}
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
          onClick={onCancel}
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
        onClick={onEdit}
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
          onClick={onBack}
          aria-label={`Back to ${city.name}`}
          title={`Back to ${city.name}`}
          className="text-muted-foreground"
        >
          <Undo2 aria-hidden />
        </Button>
      )}
    </span>
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
  const [cityView, setCityView] = useState<{
    city: City;
    events: UserEvent[];
  } | null>(null);
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
      setCityView(null);
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
      setCityView({ city: selected, events: await res.json() });
      setEditingCity(false);
    });
  }

  // Events come with known artists included regardless of the user's global
  // setting; the filter toggles below only affect this view.
  const shownEvents = cityView ? cityView.events : events;
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

  return (
    <div>
      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
        <span>Upcoming concerts in</span>
        <CityTitleField
          city={city}
          viewCity={cityView?.city ?? null}
          editing={editingCity}
          loading={loading}
          onSelect={selectCity}
          onEdit={() => setEditingCity(true)}
          onCancel={() => setEditingCity(false)}
          onBack={() => setCityView(null)}
        />
        <span>({visibleEvents.length})</span>
      </h3>
      <RelationFilterBar
        showSuggested={showSuggested}
        onShowSuggested={setShowSuggested}
        showKnown={showKnown}
        onShowKnown={setShowKnown}
        sortKey={sortKey}
        onSortKey={setSortKey}
        sortOptions={sortOptions}
        className="mt-3"
      />
      <div className="mt-3">
        <AnimatedHeight>
          {visibleEvents.length === 0 && hiddenCount === 0 ? (
            <EmptyStateCell>
              {cityView
                ? "No concerts found. Try a different city."
                : `No concerts found near ${city.name}. NextFM will find new concerts as they're announced.`}
            </EmptyStateCell>
          ) : (
            <ul className={CARD_GRID_CLASS}>
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
                          {/* The date rides inside the title row but is
                              metadata, not the title: it stays on the body
                              face rather than inheriting the display one. */}
                          <span className="ml-auto shrink-0 text-right font-sans text-xs font-normal text-muted-foreground">
                            <span className="block">
                              {concertDateFormat.format(startsAt)}
                            </span>
                            {concertTimeFormat.format(startsAt)}
                          </span>
                        </CardTitle>
                        {/* 13px steps the venue line below the title without
                            fading it all the way to the text-xs metadata. */}
                        <CardDescription className="flex items-start gap-1 text-[13px]/4">
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
              {hiddenCount > 0 && (
                <HiddenByFiltersCell count={hiddenCount} noun="concert" />
              )}
            </ul>
          )}
        </AnimatedHeight>
      </div>
    </div>
  );
}
