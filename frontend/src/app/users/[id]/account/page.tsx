import Link from "next/link";

import { AttentionDot } from "../attention-dot";
import { CityPanel, type City } from "../city-panel";
import { DeleteUserButton } from "../delete-user-button";
import { DiscoveryToggle } from "../discovery-toggle";
import { LastfmPanel, type LastfmAccount } from "../lastfm-panel";
import { SyncCard } from "../sync-card";
import { TastePanel, type Artist, type UserArtist } from "../taste-panel";
import { KNOWN_ARTIST_KINDS } from "../artist-kinds";
import { apiUrl, fetchJson, fetchOptional, loadUser } from "../user-api";

export default async function AccountPage(
  props: PageProps<"/users/[id]/account">,
) {
  const { id } = await props.params;
  const user = await loadUser(id);

  const [lastfm, city, userArtists, allArtists] = await Promise.all([
    fetchOptional<LastfmAccount>(
      `${apiUrl}/users/${id}/lastfm`,
      "Last.fm account",
    ),
    fetchOptional<City>(`${apiUrl}/users/${id}/city`, "city"),
    fetchJson<UserArtist[]>(`${apiUrl}/users/${id}/artists`, "user artists"),
    fetchJson<Artist[]>(`${apiUrl}/artists`, "artists"),
  ]);

  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link
        href={`/users/${id}`}
        className="text-sm text-gray-500 hover:underline"
      >
        &larr; Back
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold">{user.name}</h1>
      <section>
        <h2 className="mb-3 text-lg font-medium">Sync</h2>
        <SyncCard userId={user.id} lastfmLinked={lastfm !== null} />
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">
          Last.fm
          {lastfm === null && <AttentionDot />}
        </h2>
        <LastfmPanel userId={user.id} account={lastfm} />
      </section>
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-medium">
          City
          {city === null && <AttentionDot />}
        </h2>
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
        <h2 className="mb-3 text-lg font-medium">
          My artists ({knownArtists.length})
        </h2>
        <TastePanel userArtists={knownArtists} allArtists={allArtists} />
      </section>
      <section className="mt-8">
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
