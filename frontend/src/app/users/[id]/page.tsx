import Link from "next/link";
import { notFound } from "next/navigation";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";
import {
  ArtistsPanel,
  type Artist,
  type UserArtist,
} from "./artists-panel";
import { CityPanel, type City } from "./city-panel";
import { DeleteUserButton } from "./delete-user-button";
import { DiscoveryToggle } from "./discovery-toggle";
import { EventsPanel, type UserEvent } from "./events-panel";
import { LastfmPanel, type LastfmAccount } from "./lastfm-panel";
import { PlaylistsPanel, type Playlist } from "./playlists-panel";
import { SuggestedArtistsPanel } from "./suggested-artists-panel";
import { Tabs } from "./tabs";

type User = {
  id: string;
  name: string;
  include_known_artists: boolean;
};

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

async function fetchJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}

async function fetchOptional<T>(url: string, what: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to load ${what}: ${res.status}`);
  }
  return res.json();
}

export default async function UserPage(props: PageProps<"/users/[id]">) {
  const { id } = await props.params;

  const userRes = await fetch(`${apiUrl}/users/${id}`, { cache: "no-store" });
  if (userRes.status === 404 || userRes.status === 422) {
    notFound();
  }
  if (!userRes.ok) {
    throw new Error(`Failed to load user: ${userRes.status}`);
  }
  const user: User = await userRes.json();

  const [lastfm, city, userArtists, allArtists, playlists] = await Promise.all([
    fetchOptional<LastfmAccount>(
      `${apiUrl}/users/${id}/lastfm`,
      "Last.fm account",
    ),
    fetchOptional<City>(`${apiUrl}/users/${id}/city`, "city"),
    fetchJson<UserArtist[]>(`${apiUrl}/users/${id}/artists`, "user artists"),
    fetchJson<Artist[]>(`${apiUrl}/artists`, "artists"),
    fetchJson<Playlist[]>(`${apiUrl}/users/${id}/playlists`, "playlists"),
  ]);

  const events =
    city !== null
      ? await fetchJson<UserEvent[]>(`${apiUrl}/users/${id}/events`, "events")
      : [];

  // The tabs overlap on purpose: an artist can hold a known-kind interest
  // below the engine's playcount floor and still be an active suggestion.
  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );
  const suggestedArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some(
      (interest) => interest.kind === SIMILAR_ARTIST_KIND,
    ),
  );
  const artistRelations = Object.fromEntries([
    ...knownArtists.map(({ artist }) => [artist.id, "known" as const]),
    ...suggestedArtists.map(({ artist }) => [artist.id, "suggested" as const]),
  ]);

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link href="/users" className="text-sm text-gray-500 hover:underline">
        &larr; Users
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold">{user.name}</h1>
      <section>
        <h2 className="mb-3 text-lg font-medium">Last.fm</h2>
        <LastfmPanel userId={user.id} account={lastfm} />
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">City</h2>
        <CityPanel userId={user.id} city={city} />
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Discovery</h2>
        <DiscoveryToggle
          userId={user.id}
          includeKnownArtists={user.include_known_artists}
        />
      </section>
      <section className="mt-8">
        <Tabs
          tabs={[
            {
              key: "artists",
              label: `Known artists (${knownArtists.length})`,
              content: (
                <ArtistsPanel
                  userId={user.id}
                  lastfmLinked={lastfm !== null}
                  userArtists={knownArtists}
                  allArtists={allArtists}
                />
              ),
            },
            {
              key: "suggested",
              label: `Suggested artists (${suggestedArtists.length})`,
              content: (
                <SuggestedArtistsPanel
                  userId={user.id}
                  lastfmLinked={lastfm !== null}
                  suggestedArtists={suggestedArtists}
                />
              ),
            },
            {
              key: "concerts",
              label: `Concerts (${events.length})`,
              content: (
                <EventsPanel
                  userId={user.id}
                  city={city}
                  hasArtists={userArtists.length > 0}
                  needsSuggestions={
                    !user.include_known_artists && suggestedArtists.length === 0
                  }
                  artistRelations={artistRelations}
                  events={events}
                />
              ),
            },
            {
              key: "playlists",
              label: `Playlists (${playlists.length})`,
              content: (
                <PlaylistsPanel
                  userId={user.id}
                  hasCity={city !== null}
                  hasArtists={userArtists.length > 0}
                  playlists={playlists}
                />
              ),
            },
          ]}
        />
      </section>
      <section className="mt-8">
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
