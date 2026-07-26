import type {
  ArtistRelation,
  City,
  LastfmAccount,
  Playlist,
  User,
  UserArtist,
} from "@/lib/api-types";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";

// The cities the user pins beyond home, in playlist order, deduped and
// without the home city itself.
export function collectPinnedCities(playlists: Playlist[], city: City): City[] {
  const pinnedCities: City[] = [];
  for (const playlist of playlists) {
    const pinned = playlist.city;
    if (
      pinned &&
      pinned.geonameid !== city.geonameid &&
      !pinnedCities.some((other) => other.geonameid === pinned.geonameid)
    ) {
      pinnedCities.push(pinned);
    }
  }
  return pinnedCities;
}

export function partitionArtists(userArtists: UserArtist[]): {
  knownArtists: UserArtist[];
  suggestedArtists: UserArtist[];
  knownOnlyArtists: UserArtist[];
  artistRelations: Record<string, ArtistRelation>;
  artistsById: Record<string, UserArtist>;
} {
  // The lists overlap on purpose: an artist can hold a known-kind interest
  // below the engine's playcount floor and still be an active suggestion.
  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );
  // A suggestion interest can briefly survive its artist's exclusion (a
  // hide landing mid-sync); never render those as suggestions.
  const suggestedArtists = userArtists.filter(
    (userArtist) =>
      !userArtist.excluded &&
      userArtist.interests.some(
        (interest) => interest.kind === SIMILAR_ARTIST_KIND,
      ),
  );
  const artistRelations: Record<string, ArtistRelation> =
    Object.fromEntries([
      ...knownArtists.map(({ artist }) => [artist.id, "known" as const]),
      ...suggestedArtists.map(({ artist }) => [artist.id, "suggested" as const]),
    ]);
  // The Artists tab's you-listen-to cards: known artists not already surfaced
  // as suggestions (an artist that is both renders as the suggestion, the
  // same precedence the concert chips use) and not hidden by the user.
  const knownOnlyArtists = knownArtists.filter(
    (userArtist) =>
      !userArtist.excluded &&
      artistRelations[userArtist.artist.id] === "known",
  );
  // Full artist records by id, for the artist popovers on concert cards.
  const artistsById: Record<string, UserArtist> = Object.fromEntries(
    userArtists.map((userArtist) => [userArtist.artist.id, userArtist]),
  );
  return {
    knownArtists,
    suggestedArtists,
    knownOnlyArtists,
    artistRelations,
    artistsById,
  };
}

// A fingerprint of the settings a sync propagates. The dialog snapshots it
// on open and warns when it diverges (see SettingsHeader). Arrays are sorted
// so reordering never reads as a change. Pinned cities are tracked
// separately (pendingPinIds), not here: removing a pin applies immediately,
// so only additions warrant the warning.
export function settingsSignature(
  user: User,
  lastfm: LastfmAccount,
  city: City,
  knownArtists: UserArtist[],
): string {
  return JSON.stringify({
    name: user.name,
    discovery: user.include_known_artists,
    lastfm: lastfm.username,
    city: city.geonameid,
    hidden: knownArtists
      .filter((a) => a.excluded)
      .map((a) => a.artist.id)
      .sort(),
  });
}

// Pins the next sync must still create on Spotify, by playlist id: a
// re-added city is a new row, so it reads as new work even when the same
// geonameid was pinned at open.
export function pendingPinIds(pinnedPlaylists: Playlist[]): string[] {
  return pinnedPlaylists
    .filter((playlist) => playlist.spotify_url === null)
    .map((playlist) => playlist.id)
    .sort();
}
