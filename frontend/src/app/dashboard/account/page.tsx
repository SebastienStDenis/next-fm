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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchJson,
  fetchOptional,
  loadMe,
  loadSyncStatus,
  syncStepCompleted,
} from "../user-api";

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

  const missingSyncActions = [
    lastfm === null && "link Last.fm account",
    city === null && "set home city",
  ].filter((item): item is string => item !== false);

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
      <IntroText className="mt-1 text-xs text-muted-foreground italic" />
      <div className="mt-6 space-y-6">
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
        <DeleteAccountButton userName={user.name} />
      </div>
    </main>
  );
}
