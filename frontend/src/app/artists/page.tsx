import { apiFetch } from "@/lib/api";

type Artist = {
  id: string;
  name: string;
};

export default async function ArtistsPage() {
  const res = await apiFetch("/artists", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load artists: ${res.status}`);
  }
  const artists: Artist[] = await res.json();

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-4 text-2xl font-semibold">Artists ({artists.length})</h1>
      <p className="mb-4 text-sm text-gray-500">
        Every artist in the registry, across all users and sources.
      </p>
      {artists.length === 0 ? (
        <p className="text-sm text-gray-500">No artists yet.</p>
      ) : (
        <ul className="space-y-2">
          {artists.map((artist) => (
            <li
              key={artist.id}
              className="rounded border border-gray-300 px-4 py-2 dark:border-gray-700"
            >
              {artist.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
