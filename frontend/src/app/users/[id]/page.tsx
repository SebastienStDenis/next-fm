import Link from "next/link";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { AttentionDot } from "./attention-dot";
import { type City } from "./city-panel";
import { EventsPanel, type UserEvent } from "./events-panel";
import { type LastfmAccount } from "./lastfm-panel";
import { PlaylistsPanel, type Playlist } from "./playlists-panel";
import { SuggestedArtistsPanel } from "./suggested-artists-panel";
import { Tabs } from "./tabs";
import { type UserArtist } from "./taste-panel";
import {
  apiUrl,
  fetchJson,
  fetchOptional,
  loadNeverSynced,
  loadUser,
} from "./user-api";

export default async function UserPage(props: PageProps<"/users/[id]">) {
  const { id } = await props.params;
  const user = await loadUser(id);

  const [lastfm, city, userArtists, playlists, neverSynced] =
    await Promise.all([
      fetchOptional<LastfmAccount>(
        `${apiUrl}/users/${id}/lastfm`,
        "Last.fm account",
      ),
      fetchOptional<City>(`${apiUrl}/users/${id}/city`, "city"),
      fetchJson<UserArtist[]>(`${apiUrl}/users/${id}/artists`, "user artists"),
      fetchJson<Playlist[]>(`${apiUrl}/users/${id}/playlists`, "playlists"),
      loadNeverSynced(id),
    ]);

  // Known-artist and ignored events are both fetched regardless of settings;
  // the events panel hides known ones behind a view-side filter and shows
  // ignored ones dimmed with an undo affordance.
  const events =
    city !== null
      ? await fetchJson<UserEvent[]>(
          `${apiUrl}/users/${id}/events?include_known_artists=true&include_ignored=true`,
          "events",
        )
      : [];

  // The lists overlap on purpose: an artist can hold a known-kind interest
  // below the engine's playcount floor and still be an active suggestion.
  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );
  const suggestedArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some(
      (interest) => interest.kind === SIMILAR_ARTIST_KIND,
    ),
  );
  const artistRelations: Record<string, "known" | "suggested"> =
    Object.fromEntries([
      ...knownArtists.map(({ artist }) => [artist.id, "known" as const]),
      ...suggestedArtists.map(({ artist }) => [artist.id, "suggested" as const]),
    ]);
  // Playlists appear only once they exist on Spotify; rows pending their
  // first sync stay hidden in the main list.
  const linkedPlaylists = playlists.filter(
    (playlist) => playlist.spotify_url !== null,
  );
  // Pinned cities whose Spotify playlist doesn't exist yet, surfaced under the
  // pin section so a fresh pin shows up before the first sync creates it.
  const pendingPins = playlists.filter(
    (playlist) => playlist.city !== null && playlist.spotify_url === null,
  );
  // The tab count matches the panel's default view: suggested artists only,
  // and not shows the user has declined.
  const suggestedEventCount = events.filter(
    (userEvent) =>
      !userEvent.ignored &&
      userEvent.artists.some(
        (artist) => artistRelations[artist.id] === "suggested",
      ),
  ).length;

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link href="/users" className="text-sm text-gray-500 hover:underline">
        &larr; Users
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{user.name}</h1>
      <Link
        href={`/users/${id}/account`}
        className="mt-1 inline-block text-sm text-gray-500 hover:underline"
      >
        Account
        {(lastfm === null || city === null || neverSynced) && <AttentionDot />}
      </Link>
      <section className="mt-6">
        <Tabs
          tabs={[
            {
              key: "suggested",
              label: `Suggested artists (${suggestedArtists.length})`,
              content: (
                <SuggestedArtistsPanel
                  userId={user.id}
                  suggestedArtists={suggestedArtists}
                />
              ),
            },
            {
              key: "concerts",
              label: `Concerts (${suggestedEventCount})`,
              content: (
                <EventsPanel
                  userId={user.id}
                  city={city}
                  hasArtists={userArtists.length > 0}
                  hasSuggestions={suggestedArtists.length > 0}
                  artistRelations={artistRelations}
                  events={events}
                />
              ),
            },
            {
              key: "playlists",
              label: `Playlists (${linkedPlaylists.length})`,
              content: (
                <PlaylistsPanel
                  userId={user.id}
                  hasCity={city !== null}
                  hasArtists={userArtists.length > 0}
                  playlists={linkedPlaylists}
                  pendingPins={pendingPins}
                />
              ),
            },
          ]}
        />
      </section>
    </main>
  );
}
