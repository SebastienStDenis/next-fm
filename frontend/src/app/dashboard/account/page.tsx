import { AttentionDot } from "../attention-dot";
import { HomeLink } from "../../home-link";
import { CityPanel, type City } from "../city-panel";
import { DeleteAccountButton } from "../delete-account-button";
import { DiscoveryToggle } from "../discovery-toggle";
import { LastfmPanel, type LastfmAccount } from "../lastfm-panel";
import { PinnedCitiesPanel } from "../pinned-cities-panel";
import { type Playlist } from "../playlists-panel";
import { SignOutButton } from "../sign-out-button";
import { SyncCard } from "../sync-card";
import { TastePanel, type UserArtist } from "../taste-panel";
import { KNOWN_ARTIST_KINDS } from "../artist-kinds";
import { IntroText } from "../../intro-text";
import {
  fetchJson,
  fetchOptional,
  hasNeverSynced,
  loadMe,
  loadSyncStatus,
  syncStepCompleted,
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

export default async function AccountPage() {
  const user = await loadMe();

  const [lastfm, city, userArtists, playlists, sync] = await Promise.all([
    fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
    fetchOptional<City>("/me/city", "city"),
    fetchJson<UserArtist[]>("/me/artists", "user artists"),
    // A playlists outage should only blank the Pinned Cities panel, not take
    // down the rest of the account page, so degrade to an empty list.
    fetchJson<Playlist[]>("/me/playlists", "playlists").catch(
      (): Playlist[] => [],
    ),
    loadSyncStatus(),
  ]);
  const neverSynced = hasNeverSynced(user, sync);

  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );
  const pinnedPlaylists = playlists.filter(
    (playlist) => playlist.city !== null,
  );

  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <HomeLink />
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="min-w-0 text-2xl font-semibold">Hey, {user.name}</h1>
        <SignOutButton />
      </div>
      <IntroText className="mt-1 text-xs text-gray-500 italic" />
      <Section
        heading="Sync"
        alert={neverSynced}
        alertText="Get started by running a sync"
        description="Imports listening history, suggests artists, finds concerts and generates playlists. Re-runs automatically every day."
        className="mt-6"
      >
        <SyncCard lastfmLinked={lastfm !== null} citySet={city !== null} />
      </Section>
      <Section
        heading="Last.fm"
        alert={lastfm === null}
        alertText="Link Last.fm account to enable sync"
        description="Listening history is imported from your Last.fm account."
        className="mt-8"
      >
        <LastfmPanel account={lastfm} />
      </Section>
      <Section
        heading="Home City"
        alert={city === null}
        alertText="Set home city to enable sync"
        description="A playlist is generated for concerts in your home city."
        className="mt-8"
      >
        <CityPanel city={city} />
      </Section>
      <Section
        heading="Pinned Cities"
        description="Extra playlists are generated for concerts in other cities you pin."
        className="mt-8"
      >
        <PinnedCitiesPanel pinned={pinnedPlaylists} />
      </Section>
      <Section heading="Options" className="mt-8">
        <DiscoveryToggle includeKnownArtists={user.include_known_artists} />
      </Section>
      <Section
        heading="Listening History"
        description="Your listening history is used to suggest artists and find concerts. Hidden artists are skipped."
        className="mt-8"
      >
        <TastePanel
          userArtists={knownArtists}
          synced={syncStepCompleted(sync, "artists")}
        />
      </Section>
      <section className="mt-8">
        <DeleteAccountButton userName={user.name} />
      </section>
    </main>
  );
}
