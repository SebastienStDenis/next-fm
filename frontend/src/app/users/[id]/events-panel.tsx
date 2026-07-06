"use client";

import { useActionState } from "react";

import { syncEvents } from "./actions";

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

export function EventsPanel({
  userId,
  hasCity,
  hasArtists,
  events,
}: {
  userId: string;
  hasCity: boolean;
  hasArtists: boolean;
  events: UserEvent[];
}) {
  const [state, formAction, pending] = useActionState(
    syncEvents.bind(null, userId),
    { error: null, summary: null },
  );

  if (!hasArtists) {
    return (
      <p className="text-sm text-gray-500">
        Sync artists first to find concerts you would like.
      </p>
    );
  }

  return (
    <div>
      <div className="space-y-2">
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? "Syncing..." : "Sync events"}
          </button>
        </form>
        {state.summary && <p className="text-sm text-gray-500">{state.summary}</p>}
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      </div>

      {!hasCity ? (
        <p className="mt-4 text-sm text-gray-500">
          Set a city to see concerts near you.
        </p>
      ) : events.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No upcoming concerts by your artists nearby. Try syncing events.
        </p>
      ) : (
        <>
          <h3 className="mt-4 text-sm font-medium">
            Upcoming concerts ({events.length})
          </h3>
          <ul className="mt-2 space-y-3">
            {events.map(({ event, url, distance_km, artists }) => (
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
                      you listen to {artist.name}
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
