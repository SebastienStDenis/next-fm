import { Settings as SettingsIcon } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { type City } from "./city-panel";
import { DashboardNotice } from "./dashboard-notice";
import { EventsPanel, type UserEvent } from "./events-panel";
import { type LastfmAccount } from "./lastfm-panel";
import { PlaylistsPanel, type Playlist } from "./playlists-panel";
import { SettingsContent } from "./settings-content";
import { SettingsDialog, SETTINGS_HASH } from "./settings-dialog";
import { SuggestedArtistsPanel } from "./suggested-artists-panel";
import { SyncStepNote } from "./sync-step-note";
import { TAB_COOKIE } from "./tab-cookie";
import { Tabs } from "./tabs";
import { type UserArtist } from "./taste-panel";
import {
  fetchJson,
  fetchOptional,
  loadEmail,
  loadMe,
  loadSyncStatus,
  syncStepCompleted,
} from "./user-api";

export default async function DashboardPage() {
  const user = await loadMe();
  const lastTab = (await cookies()).get(TAB_COOKIE)?.value;

  const [lastfm, city, userArtists, playlists, sync, email] =
    await Promise.all([
      fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
      fetchOptional<City>("/me/city", "city"),
      fetchJson<UserArtist[]>("/me/artists", "user artists"),
      fetchJson<Playlist[]>("/me/playlists", "playlists"),
      loadSyncStatus(),
      loadEmail(),
    ]);
  // The dashboard requires a linked Last.fm account, a home city and a
  // successful sync (`last_synced_at`, a durable DB stamp independent of
  // Temporal retention); anyone short of that goes through the welcome flow
  // instead. This is the exact inverse of the welcome footer's reveal gate,
  // so the two never disagree on whether a user is onboarded. A failed-only
  // run doesn't admit them: the dashboard is empty without a successful sync,
  // and the welcome card is where the failure and its retry live.
  if (lastfm === null || city === null || user.last_synced_at === null) {
    redirect("/welcome");
  }

  // Known-artist events are fetched regardless of the user's global setting;
  // the events panel hides them behind its own view-side filter.
  const events = await fetchJson<UserEvent[]>(
    "/me/events?include_known_artists=true",
    "events",
  );

  // The lists overlap on purpose: an artist can hold a known-kind interest
  // below the engine's playcount floor and still be an active suggestion.
  const knownArtists = userArtists.filter((userArtist) =>
    userArtist.interests.some((interest) => KNOWN_ARTIST_KINDS.has(interest.kind)),
  );
  // A suggestion interest can briefly survive its artist's exclusion (a
  // hide landing mid-sync); never render those as suggestions.
  const suggestedArtists = userArtists.filter(
    (userArtist) =>
      !userArtist.excluded &&
      userArtist.interests.some(
        (interest) => interest.kind === SIMILAR_ARTIST_KIND,
      ),
  );
  const artistRelations: Record<string, "known" | "suggested"> =
    Object.fromEntries([
      ...knownArtists.map(({ artist }) => [artist.id, "known" as const]),
      ...suggestedArtists.map(({ artist }) => [artist.id, "suggested" as const]),
    ]);
  // Playlists appear only once they exist on Spotify; pins awaiting their
  // first sync are managed in Settings, not shown here.
  const linkedPlaylists = playlists.filter(
    (playlist) => playlist.spotify_url !== null,
  );
  const pinnedPlaylists = playlists.filter(
    (playlist) => playlist.city !== null,
  );
  // The tab count matches the panel's default view: suggested artists only.
  const suggestedEventCount = events.filter((userEvent) =>
    userEvent.artists.some(
      (artist) => artistRelations[artist.id] === "suggested",
    ),
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense>
        <DashboardNotice />
      </Suspense>
      <span className="text-sm text-muted-foreground">NextFM</span>
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Hey, {user.name}</h1>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href={SETTINGS_HASH}>
            <SettingsIcon aria-hidden />
            Settings
          </a>
        </Button>
      </div>
      <section className="mt-6">
        <Tabs
          defaultTab={lastTab ?? "playlists"}
          tabs={[
            {
              key: "suggested",
              label: `Artists (${suggestedArtists.length})`,
              description:
                "Artists you might like based on your listening history.",
              note: (
                <SyncStepNote
                  sync={sync}
                  stepKey="suggestions"
                  label="Suggest artists"
                />
              ),
              content: (
                <SuggestedArtistsPanel
                  suggestedArtists={suggestedArtists}
                  synced={syncStepCompleted(sync, "suggestions")}
                />
              ),
            },
            {
              key: "concerts",
              label: `Concerts (${suggestedEventCount})`,
              description: "Upcoming concerts near you by suggested artists.",
              note: (
                <SyncStepNote
                  sync={sync}
                  stepKey="events"
                  label="Find concerts"
                />
              ),
              content: (
                <EventsPanel
                  city={city}
                  synced={syncStepCompleted(sync, "events")}
                  artistRelations={artistRelations}
                  events={events}
                />
              ),
            },
            {
              key: "playlists",
              label: (
                <>
                  {linkedPlaylists.length > 0 && (
                    <span className="shrink-0 animate-fade-in" aria-hidden>
                      <span className="block size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-current" />
                    </span>
                  )}
                  Playlists ({linkedPlaylists.length})
                </>
              ),
              description:
                "Spotify playlists tracking suggested concerts in your cities, updated daily.",
              note: (
                <SyncStepNote
                  sync={sync}
                  stepKey="playlists"
                  label="Generate playlists"
                />
              ),
              content: (
                <PlaylistsPanel
                  synced={syncStepCompleted(sync, "playlists")}
                  playlists={linkedPlaylists}
                  showPinHint={pinnedPlaylists.length === 0}
                />
              ),
            },
          ]}
        />
      </section>
      <SettingsDialog>
        <SettingsContent
          user={user}
          email={email}
          lastfm={lastfm}
          city={city}
          knownArtists={knownArtists}
          pinnedPlaylists={pinnedPlaylists}
          sync={sync}
        />
      </SettingsDialog>
    </main>
  );
}
