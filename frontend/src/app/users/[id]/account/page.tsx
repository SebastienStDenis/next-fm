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
  alertText,
  description,
  className,
  children,
}: {
  heading: string;
  alert?: boolean;
  alertText?: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-3">
        <h2 className="flex items-center text-lg font-medium">
          {heading}
          {alert && alertText && (
            <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-foreground dark:bg-gray-800">
              <AttentionDot />
              {alertText}
            </span>
          )}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-gray-500 italic">{description}</p>
        )}
      </div>
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
      <h1 className="mt-2 text-2xl font-semibold">Hey, {user.name}</h1>
      <p className="mt-1 mb-6 text-xs text-gray-500 italic">
        After making updates on this page, run a sync to generate new
        suggestions and playlists, or wait for the next automated sync.
      </p>
      <Section
        heading="Sync"
        alert={neverSynced}
        alertText="Get started by running your first sync"
        description="Automatically import listening history, suggest concerts and create playlists."
      >
        <SyncCard
          userId={user.id}
          lastfmLinked={lastfm !== null}
          citySet={city !== null}
        />
      </Section>
      <Section
        heading="Last.fm"
        alert={lastfm === null}
        alertText="Link Last.fm account to enable sync"
        description="Listening history is imported from your Last.fm account."
        className="mt-8"
      >
        <LastfmPanel userId={user.id} account={lastfm} />
      </Section>
      <Section
        heading="Home City"
        alert={city === null}
        alertText="Set home city to enable sync"
        description="A playlist is created for concerts in your home city."
        className="mt-8"
      >
        <CityPanel userId={user.id} city={city} />
      </Section>
      <Section heading="Options" className="mt-8">
        <DiscoveryToggle
          userId={user.id}
          includeKnownArtists={user.include_known_artists}
        />
      </Section>
      <Section
        heading="My Artists"
        description="Artists you listen to are used to suggest new artists and concerts."
        className="mt-8"
      >
        <TastePanel userArtists={knownArtists} />
      </Section>
      <section className="mt-8">
        <DeleteUserButton userId={user.id} userName={user.name} />
      </section>
    </main>
  );
}
