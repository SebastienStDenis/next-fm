import type { ArtistRelation, UserArtist, UserEvent } from "@/lib/api-types";

import { type SortOption } from "./sort-select";
import { playsOf, rankOf, scoreOf } from "./user-artist";

// A title that only repeats the venue name is not a title - source
// listings are often named after their venue ("Public Records") - so the
// heading falls back to the artists and the venue keeps its slot.
// Compared trimmed: source strings carry stray whitespace
// ("Moda Center "). Shared with the artist cards' concerts popover so
// both surfaces agree on which titles are real.
export function eventTitle(event: UserEvent["event"]): string | null {
  return event.title && event.title.trim() !== event.venue_name.trim()
    ? event.title
    : null;
}

// Sorting by name uses the same name the card displays as its heading.
export function eventName(userEvent: UserEvent): string {
  return (
    eventTitle(userEvent.event) ??
    userEvent.artists.map((artist) => artist.name).join(", ")
  );
}

export type SortKey = "date" | "name" | "match";

export const sortOptions: readonly SortOption<SortKey>[] = [
  { value: "date", label: "Date" },
  { value: "name", label: "Name" },
  { value: "match", label: "Best match" },
];

function byName(a: UserEvent, b: UserEvent): number {
  return eventName(a).localeCompare(eventName(b));
}

// Best match leads with concerts featuring an artist rendered as
// you-listen-to, in the Artists tab's plays order taken from the bill's
// best such artist (lowest Last.fm top-artist rank, highest raw playcount
// for the unranked); suggestion-only concerts follow by the summed score
// of every artist rendered as a suggestion. Each artist counts by the
// signal its chip displays (the relation map): an artist with both
// listening history and a suggestion reads as a suggestion, so it adds
// its score rather than lifting the concert into the you-listen-to block.
export function makeComparators(
  relations: Record<string, ArtistRelation>,
  artistsById: Record<string, UserArtist>,
): Record<SortKey, (a: UserEvent, b: UserEvent) => number> {
  const hasKnown = (userEvent: UserEvent) =>
    userEvent.artists.some((artist) => relations[artist.id] === "known");
  const knownArtists = (userEvent: UserEvent) =>
    userEvent.artists.filter((artist) => relations[artist.id] === "known");
  const bestRank = (userEvent: UserEvent) =>
    Math.min(
      Number.MAX_SAFE_INTEGER,
      ...knownArtists(userEvent).map((artist) => rankOf(artistsById[artist.id])),
    );
  const bestPlays = (userEvent: UserEvent) =>
    Math.max(
      -1,
      ...knownArtists(userEvent).map((artist) =>
        playsOf(artistsById[artist.id]),
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
      bestRank(a) - bestRank(b) ||
      bestPlays(b) - bestPlays(a) ||
      scoreSum(b) - scoreSum(a) ||
      byName(a, b),
  };
}
