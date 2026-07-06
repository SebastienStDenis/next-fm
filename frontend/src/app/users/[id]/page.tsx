import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArtistsPanel,
  type Artist,
  type UserArtist,
} from "./artists-panel";
import { CityPanel, type City } from "./city-panel";
import { DeleteUserButton } from "./delete-user-button";
import { EventsPanel, type UserEvent } from "./events-panel";
import { LastfmPanel, type LastfmAccount } from "./lastfm-panel";

type User = {
  id: string;
  name: string;
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

  const [lastfm, city, userArtists, allArtists] = await Promise.all([
    fetchOptional<LastfmAccount>(
      `${apiUrl}/users/${id}/lastfm`,
      "Last.fm account",
    ),
    fetchOptional<City>(`${apiUrl}/users/${id}/city`, "city"),
    fetchJson<UserArtist[]>(`${apiUrl}/users/${id}/artists`, "user artists"),
    fetchJson<Artist[]>(`${apiUrl}/artists`, "artists"),
  ]);

  const events =
    city !== null
      ? await fetchJson<UserEvent[]>(`${apiUrl}/users/${id}/events`, "events")
      : [];

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
        <h2 className="mb-3 text-lg font-medium">Artists</h2>
        <ArtistsPanel
          userId={user.id}
          lastfmLinked={lastfm !== null}
          userArtists={userArtists}
          allArtists={allArtists}
        />
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">Concerts</h2>
        <EventsPanel
          userId={user.id}
          hasCity={city !== null}
          hasArtists={userArtists.length > 0}
          events={events}
        />
      </section>
      <section className="mt-8">
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
