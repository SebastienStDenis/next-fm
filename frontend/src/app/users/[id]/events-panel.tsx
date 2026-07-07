"use client";

import { useState, useTransition } from "react";

import type { City } from "./city-panel";
import { CitySearchBox, cityLabel } from "./city-search-box";

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
  userId,
  city,
  hasArtists,
  needsSuggestions,
  artistRelations,
  events,
}: {
  userId: string;
  city: City | null;
  hasArtists: boolean;
  needsSuggestions: boolean;
  artistRelations: Record<string, ArtistRelation>;
  events: UserEvent[];
}) {
  const [viewCity, setViewCity] = useState<City | null>(null);
  const [viewEvents, setViewEvents] = useState<UserEvent[]>([]);
  const [viewError, setViewError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();

  if (!hasArtists) {
    return (
      <p className="text-sm text-gray-500">
        Sync artists first to find concerts you would like.
      </p>
    );
  }

  function selectCity(selected: City) {
    startTransition(async () => {
      const res = await fetch(
        `/api/users/${userId}/events?geonameid=${selected.geonameid}`,
      );
      if (!res.ok) {
        setViewError("Failed to load concerts for that city.");
        return;
      }
      setViewEvents(await res.json());
      setViewCity(selected);
      setViewError(null);
    });
  }

  const shownEvents = viewCity ? viewEvents : events;

  return (
    <div>
      <div className="space-y-2">
        <CitySearchBox
          placeholder="See concerts in another city"
          disabled={loading}
          onSelect={selectCity}
        />
        {viewCity && (
          <p className="text-sm text-gray-500">
            Showing concerts near {cityLabel(viewCity)}.{" "}
            <button
              type="button"
              onClick={() => setViewCity(null)}
              className="underline hover:text-gray-700 dark:hover:text-gray-300"
            >
              {city ? `Back to ${city.name}` : "Back to your city"}
            </button>
          </p>
        )}
        {viewError && <p className="text-sm text-red-600">{viewError}</p>}
      </div>

      {!city && !viewCity ? (
        <p className="mt-4 text-sm text-gray-500">
          Set a city to see concerts near you, or search one above.
        </p>
      ) : shownEvents.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          {needsSuggestions
            ? "Concerts show suggested artists only, and you have none yet. Sync suggestions in the Suggested artists tab, or include artists you know via the Discovery setting."
            : viewCity
              ? `No upcoming concerts by your artists near ${viewCity.name}.`
              : "No upcoming concerts by your artists nearby. Try syncing."}
        </p>
      ) : (
        <>
          <h3 className="mt-4 text-sm font-medium">
            Upcoming concerts ({shownEvents.length})
          </h3>
          <ul className="mt-2 space-y-3">
            {shownEvents.map(({ event, url, distance_km, artists }) => (
              <li
                key={event.id}
                className="rounded border border-gray-300 p-3 dark:border-gray-700"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {artists.map((artist) => (
                    <span
                      key={artist.id}
                      className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700"
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
                      Tickets ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
