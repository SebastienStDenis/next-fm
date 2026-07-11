"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";

import type { ActionState } from "./actions";
import type { City } from "./city-panel";
import { CitySearchBox } from "./city-search-box";
import { EmptyState } from "./empty-state";
import { PencilMark } from "./pencil-mark";
import { RunSyncMessage } from "./run-sync-message";
import { Spinner } from "../spinner";
import { UndoMark } from "./undo-mark";
import { useTransientError } from "./use-transient-error";
import { XMark } from "./x-mark";

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
  return [event.city_name, event.region, event.country]
    .filter(Boolean)
    .join(", ");
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
  const [viewResult, setViewResult] = useState<ActionState>({ error: null });
  const viewError = useTransientError(viewResult);
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
        setViewResult({ error: "Failed to load concerts for that city." });
        return;
      }
      setViewEvents(await res.json());
      setViewCity(selected);
      setViewResult({ error: null });
      setEditingCity(false);
    });
  }

  // Events come with known artists included regardless of the user's global
  // setting; the filter pills below only affect this view.
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
  // While viewing another city, a second X jumps back to the home city.
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
        <span className="flex text-gray-500">
          <Spinner />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setEditingCity(false)}
          aria-label="Cancel"
          title="Cancel"
          className="-m-1 flex rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <XMark className="h-4 w-4" />
        </button>
      )}
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setEditingCity(true)}
        title="See concerts in another city"
        className="-m-1 flex min-w-0 items-center gap-1.5 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <span className="min-w-0">{shownCity?.name ?? "another city"}</span>
        <span className="flex text-gray-500">
          <PencilMark />
        </span>
      </button>
      {viewCity && city && (
        <button
          type="button"
          onClick={() => setViewCity(null)}
          aria-label={`Back to ${city.name}`}
          title={`Back to ${city.name}`}
          className="-m-1 flex rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <UndoMark />
        </button>
      )}
    </span>
  );
  const cityError = viewError && !loading && (
    <p
      key={viewError.key}
      className="mt-2 animate-fade-in-out text-xs text-red-600"
    >
      {viewError.message}
    </p>
  );

  return (
    <div>
      {!city && !viewCity ? (
        <div>
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
            <span>Upcoming concerts in</span>
            {cityField}
          </h3>
          {cityError}
          <EmptyState className="mt-4">
            Set your home city in{" "}
            <Link
              href="/dashboard/account"
              className="underline hover:text-foreground"
            >
              Account
            </Link>{" "}
            to see local concerts.
          </EmptyState>
        </div>
      ) : (
        <>
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
            <span>Upcoming concerts in</span>
            {cityField}
            <span>({visibleEvents.length})</span>
          </h3>
          {cityError}
          <div className="mt-3 flex flex-wrap gap-2">
            <FilterPill
              selected={showSuggested}
              onToggle={() => setShowSuggested(!showSuggested)}
            >
              Suggested artists
            </FilterPill>
            <FilterPill
              selected={showKnown}
              onToggle={() => setShowKnown(!showKnown)}
            >
              Artists you listen to
            </FilterPill>
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
              {visibleEvents.map(({ event, url, distance_km, artists }) => (
                <li
                  key={event.id}
                  className="flex flex-col rounded border border-gray-300 p-3 dark:border-gray-700"
                >
                  {/* gap-y-1 matches the mt-1 below, so a wrapped date sits as
                      close to the title above as to the venue line below. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                    <span className="min-w-0 font-medium">
                      {event.title ??
                        artists.map((artist) => artist.name).join(", ")}
                    </span>
                    <span className="text-xs text-gray-500">
                      {dateFormat.format(new Date(event.starts_at))}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {event.venue_name} · {placeLabel(event)} · {distance_km} km
                    away
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    {artists.map((artist) => (
                      <span
                        key={artist.id}
                        className="max-w-full rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700"
                      >
                        {artistChipLabel(artist, artistRelations)}
                      </span>
                    ))}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300"
                      >
                        Tickets {"\u2197\uFE0E"}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hiddenCount > 0 && (
            <p className="mt-3 text-xs text-gray-500 italic">
              {hiddenCount} {hiddenCount === 1 ? "concert is" : "concerts are"}{" "}
              hidden by filters.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FilterPill({
  selected,
  onToggle,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-gray-300 text-gray-500 hover:text-foreground dark:border-gray-700"
      }`}
    >
      {children}
    </button>
  );
}
