import Link from "next/link";

import { AttentionDot } from "../attention-dot";
import { CityPanel, type City } from "../city-panel";
import { DeleteUserButton } from "../delete-user-button";
import { DiscoveryToggle } from "../discovery-toggle";
import { LastfmPanel, type LastfmAccount } from "../lastfm-panel";
import { SyncCard } from "../sync-card";
import { TastePanel, type UserArtist } from "../taste-panel";
import { KNOWN_ARTIST_KINDS } from "../artist-kinds";
import {
  apiUrl,
  fetchJson,
  fetchOptional,
  loadNeverSynced,
  loadUser,
} from "../user-api";

function Section({
  heading,
  alert,
  className,
  children,
}: {
  heading: string;
  alert?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <h2 className="mb-3 text-lg font-medium">
        {heading}
        {alert && <AttentionDot />}
      </h2>
      <div className="rounded border border-gray-300 p-4 dark:border-gray-700">
        {children}
      </div>
    </section>
  );
}

export default async function AccountPage(
  props: PageProps<"/users/[id]/account">,
) {
  const { id } = await props.params;
  const user = await loadUser(id);

  const [lastfm, city, userArtists, neverSynced] = await Promise.all([
    fetchOptional<LastfmAccount>(
      `${apiUrl}/users/${id}/lastfm`,
      "Last.fm account",
    ),
    fetchOptional<City>(`${apiUrl}/users/${id}/city`, "city"),
    fetchJson<UserArtist[]>(`${apiUrl}/users/${id}/artists`, "user artists"),
    loadNeverSynced(id),
  ]);

  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <Link
        href={`/users/${id}`}
        className="text-sm text-gray-500 hover:underline"
      >
        &larr; Back
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold">{user.name}</h1>
      <Section heading="Sync" alert={neverSynced}>
        <SyncCard
          userId={user.id}
          lastfmLinked={lastfm !== null}
          citySet={city !== null}
        />
      </Section>
      <Section
        heading="Last.fm"
        alert={lastfm === null}
        className="mt-8"
      >
        <LastfmPanel userId={user.id} account={lastfm} />
      </Section>
      <Section heading="City" alert={city === null} className="mt-8">
        <CityPanel userId={user.id} city={city} />
      </Section>
      <Section heading="Discovery" className="mt-8">
        <DiscoveryToggle
          userId={user.id}
          includeKnownArtists={user.include_known_artists}
        />
      </Section>
      <Section heading="My artists" className="mt-8">
        <TastePanel userArtists={knownArtists} />
      </Section>
      <section className="mt-8">
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
