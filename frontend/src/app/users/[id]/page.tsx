import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArtistsPanel,
  type Artist,
  type UserArtist,
} from "./artists-panel";
import { DeleteUserButton } from "./delete-user-button";
import { LastfmPanel, type LastfmAccount } from "./lastfm-panel";

type User = {
  id: string;
  name: string;
};

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

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

  const lastfmRes = await fetch(`${apiUrl}/users/${id}/lastfm`, {
    cache: "no-store",
  });
  if (!lastfmRes.ok && lastfmRes.status !== 404) {
    throw new Error(`Failed to load Last.fm account: ${lastfmRes.status}`);
  }
  const lastfm: LastfmAccount | null = lastfmRes.ok
    ? await lastfmRes.json()
    : null;

  const userArtistsRes = await fetch(`${apiUrl}/users/${id}/artists`, {
    cache: "no-store",
  });
  if (!userArtistsRes.ok) {
    throw new Error(`Failed to load user artists: ${userArtistsRes.status}`);
  }
  const userArtists: UserArtist[] = await userArtistsRes.json();

  const allArtistsRes = await fetch(`${apiUrl}/artists`, {
    cache: "no-store",
  });
  if (!allArtistsRes.ok) {
    throw new Error(`Failed to load artists: ${allArtistsRes.status}`);
  }
  const allArtists: Artist[] = await allArtistsRes.json();

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
        <h2 className="mb-3 text-lg font-medium">Artists</h2>
        <ArtistsPanel
          userId={user.id}
          lastfmLinked={lastfm !== null}
          userArtists={userArtists}
          allArtists={allArtists}
        />
      </section>
      <section className="mt-8">
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
