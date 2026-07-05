import Link from "next/link";
import { notFound } from "next/navigation";

import { CityPanel, type City } from "./city-panel";
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

  const cityRes = await fetch(`${apiUrl}/users/${id}/city`, {
    cache: "no-store",
  });
  if (!cityRes.ok && cityRes.status !== 404) {
    throw new Error(`Failed to load city: ${cityRes.status}`);
  }
  const city: City | null = cityRes.ok ? await cityRes.json() : null;

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
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
