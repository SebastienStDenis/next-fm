import { AttentionDot } from "./attention-dot";
import { CityPanel, type City } from "./city-panel";
import { DeleteAccountButton } from "./delete-account-button";
import { DiscoveryToggle } from "./discovery-toggle";
import { LastfmPanel, type LastfmAccount } from "./lastfm-panel";
import { PinnedCitiesPanel } from "./pinned-cities-panel";
import { type Playlist } from "./playlists-panel";
import { SignOutButton } from "./sign-out-button";
import { SyncCard, type SyncStatus } from "./sync-card";
import { TastePanel, type UserArtist } from "./taste-panel";
import { type User } from "./user-api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { syncStepCompleted } from "./user-api";

function Section({
  heading,
  alert,
  alertText,
  description,
  children,
}: {
  heading: string;
  alert?: boolean;
  alertText?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2>{heading}</h2>
          {alert && alertText && (
            <Badge
              variant="secondary"
              className="h-auto min-h-5 px-1.5 font-normal whitespace-normal"
            >
              <AttentionDot />
              {alertText}
            </Badge>
          )}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs italic">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

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
  lastfm: LastfmAccount | null;
  city: City | null;
  knownArtists: UserArtist[];
  pinnedPlaylists: Playlist[];
  sync: SyncStatus | null;
}) {
  const missingSyncActions = [
    lastfm === null && "link Last.fm account",
    city === null && "set home city",
  ].filter((item): item is string => item !== false);

  return (
    <div className="space-y-6">
      <Section
        heading="Daily Sync"
        alert={missingSyncActions.length > 0}
        alertText={`Disabled, ${missingSyncActions.join(" and ")}`}
        description="Imports listening history, suggests artists, finds concerts and generates playlists."
      >
        <SyncCard lastfmLinked={lastfm !== null} citySet={city !== null} />
      </Section>
      <Section
        heading="Last.fm"
        alert={lastfm === null}
        alertText="Link Last.fm account to enable sync"
        description="Listening history is imported from your Last.fm account."
      >
        <LastfmPanel account={lastfm} />
      </Section>
      <Section
        heading="Home City"
        alert={city === null}
        alertText="Set home city to enable sync"
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
