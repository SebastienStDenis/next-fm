import { CityPanel, type City } from "./city-panel";
import { DeleteAccountButton } from "./delete-account-button";
import { DiscoveryToggle } from "./discovery-toggle";
import { LastfmPanel, type LastfmAccount } from "./lastfm-panel";
import { PinnedCitiesPanel } from "./pinned-cities-panel";
import { type Playlist } from "./playlists-panel";
import { Section } from "./section";
import { SignOutButton } from "./sign-out-button";
import { SyncCard } from "./sync-card";
import { type SyncStatus } from "./sync-steps";
import { TastePanel, type UserArtist } from "./taste-panel";
import { type User } from "./user-api";
import { syncStepCompleted } from "./user-api";

export function SettingsContent({
  user,
  email,
  lastfm,
  city,
  knownArtists,
  pinnedPlaylists,
  sync,
}: {
  user: User;
  email: string | null;
  lastfm: LastfmAccount;
  city: City;
  knownArtists: UserArtist[];
  pinnedPlaylists: Playlist[];
  sync: SyncStatus | null;
}) {
  return (
    <div className="space-y-6">
      <Section
        heading="Daily Sync"
        description="Imports listening history, suggests artists, finds concerts and generates playlists."
      >
        <SyncCard lastfmLinked citySet />
      </Section>
      <Section
        heading="Last.fm"
        description="Listening history is imported from your Last.fm account."
      >
        <LastfmPanel account={lastfm} />
      </Section>
      <Section
        heading="Home City"
        description="A playlist is generated for concerts in your home city."
      >
        <CityPanel city={city} />
      </Section>
      <Section
        heading="Pinned Cities"
        description="Extra playlists are generated for concerts in other cities you pin."
      >
        <PinnedCitiesPanel pinned={pinnedPlaylists} />
      </Section>
      <Section heading="Options">
        <DiscoveryToggle includeKnownArtists={user.include_known_artists} />
      </Section>
      <Section
        heading="Listening History"
        description="Your listening history is used to suggest artists and find concerts. Hidden artists are skipped."
      >
        <TastePanel
          userArtists={knownArtists}
          synced={syncStepCompleted(sync, "artists")}
        />
      </Section>
      <Section heading="Account">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="font-medium">{user.name}</p>
            {email && (
              <p className="truncate text-sm text-muted-foreground">{email}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SignOutButton />
            <DeleteAccountButton userName={user.name} />
          </div>
        </div>
      </Section>
    </div>
  );
}
