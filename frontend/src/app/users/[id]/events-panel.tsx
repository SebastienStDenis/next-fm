"use client";

import { useState, useTransition, type ReactNode } from "react";

import { ignoreEvent, unignoreEvent } from "./actions";
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
  ignored: boolean;
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
  hasSuggestions,
  artistRelations,
  events,
}: {
  userId: string;
  city: City | null;
  hasArtists: boolean;
  hasSuggestions: boolean;
  artistRelations: Record<string, ArtistRelation>;
  events: UserEvent[];
}) {
  const [showSuggested, setShowSuggested] = useState(true);
  const [showKnown, setShowKnown] = useState(false);
  const [viewCity, setViewCity] = useState<City | null>(null);
  const [viewEvents, setViewEvents] = useState<UserEvent[]>([]);
  const [viewError, setViewError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  // Overrides the server-side ignored flag between an ignore/undo click and
  // the page refresh, so the toggle feels instant in both the local and
  // searched-city views.
  const [ignoreOverlay, setIgnoreOverlay] = useState<Record<string, boolean>>(
    {},
  );
  const [pendingIgnore, setPendingIgnore] = useState<string | null>(null);
  const [, startIgnore] = useTransition();

  function isIgnored(userEvent: UserEvent): boolean {
    return ignoreOverlay[userEvent.event.id] ?? userEvent.ignored;
  }

  function toggleIgnore(userEvent: UserEvent) {
    const eventId = userEvent.event.id;
    const nextIgnored = !isIgnored(userEvent);
    setPendingIgnore(eventId);
    startIgnore(async () => {
      const result = nextIgnored
        ? await ignoreEvent(userId, eventId)
        : await unignoreEvent(userId, eventId);
      setPendingIgnore(null);
      if (result.error) {
        setViewError(result.error);
        return;
      }
      setIgnoreOverlay((prev) => ({ ...prev, [eventId]: nextIgnored }));
      setViewError(null);
    });
  }

  if (!hasArtists) {
    return (
      <p className="text-sm text-gray-500">
        Nothing synced yet. Run a sync from the Account section to find
        concerts you would like.
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
  // Ignored shows still render (dimmed, with an undo control) but do not count
  // toward the headline, keeping it in step with the Concerts tab badge.
  const activeCount = visibleEvents.filter(
    (userEvent) => !isIgnored(userEvent),
  ).length;

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
          Set your city in the Account section to see local concerts, or
          search one above.
        </p>
      ) : (
        <>
          <h3 className="mt-4 text-sm font-medium">
            Upcoming concerts ({activeCount})
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
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
              My artists
            </FilterPill>
          </div>
          {visibleEvents.length === 0 ? (
            hiddenCount === 0 && (
              <p className="mt-4 text-sm text-gray-500">
                {!hasSuggestions
                  ? "No suggested artists yet, so no concerts to show. Sync to get some."
                  : viewCity
                    ? `No upcoming concerts by your artists near ${viewCity.name}.`
                    : "No upcoming concerts by your artists nearby. Try syncing."}
              </p>
            )
          ) : (
            <ul className="mt-3 space-y-3">
              {visibleEvents.map((userEvent) => {
                const { event, url, distance_km, artists } = userEvent;
                const ignored = isIgnored(userEvent);
                return (
                  <li
                    key={event.id}
                    className={`rounded border border-gray-300 p-3 dark:border-gray-700 ${
                      ignored ? "opacity-50" : ""
                    }`}
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
                      <button
                        type="button"
                        onClick={() => toggleIgnore(userEvent)}
                        disabled={pendingIgnore === event.id}
                        className="ml-auto text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-50 dark:hover:text-gray-300"
                      >
                        {ignored ? "Undo" : "Not interested"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {hiddenCount > 0 && (
            <p className="mt-3 text-sm text-gray-500">
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
