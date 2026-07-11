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
    <main className="mx-auto w-full max-w-xl p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        Artists ({artists.length})
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Every artist in the registry, across all users and sources.
      </p>
      {artists.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No artists yet.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {artists.map((artist) => (
            <li key={artist.id} className="px-4 py-2.5 text-sm">
              {artist.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
