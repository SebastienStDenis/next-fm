import { Settings as SettingsIcon } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import type {
  City,
  LastfmAccount,
  Playlist,
  UserArtist,
  UserEvent,
} from "@/lib/api-types";
import {
  fetchJson,
  fetchOptional,
  loadEmail,
  loadMe,
  loadSyncStatus,
  syncStepCompleted,
  userEventsPath,
} from "@/lib/user-api";

import { QueryNotice } from "@/components/query-notice";
import { ArtistsPanel, type CityConcerts } from "./artists-panel";
import {
  collectPinnedCities,
  partitionArtists,
  pendingPinIds,
  settingsSignature,
} from "./derive";
import { EventsPanel } from "./events-panel";
import { PlaylistsPanel } from "./playlists-panel";
import { SettingsContent } from "./settings-content";
import { SettingsDialog } from "./settings-dialog";
import { SETTINGS_HASH } from "./settings-hash";
import { SyncStepNote } from "./sync-step-note";
import { TAB_COOKIE } from "./tab-cookie";
import { Tabs } from "./tabs";

// Auth redirects land on the dashboard with a `?notice=` (success) or `?error=`
// (a failed email link, since the change is confirmed while signed in) value.
const NOTICES: Record<string, string> = {
  "password-reset": "Password changed. You're signed in.",
  "email-changed": "Email changed.",
};
const ERRORS: Record<string, string> = {
  confirm: "That email link is invalid or has expired.",
};

export default async function DashboardPage() {
  const userPromise = loadMe();
  const dataPromise = Promise.all([
    fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
    fetchOptional<City>("/me/city", "city"),
    fetchJson<UserArtist[]>("/me/artists", "user artists"),
    fetchJson<Playlist[]>("/me/playlists", "playlists"),
    loadSyncStatus(),
    loadEmail(),
  ]);
  // The user await comes first so a gone user (notFound/redirect) beats any
  // fetch failure; the noop catch keeps the fan-out's rejection from going
  // unhandled when loadMe throws - awaiting it below still surfaces it.
  dataPromise.catch(() => {});
  const lastTab = (await cookies()).get(TAB_COOKIE)?.value;
  const user = await userPromise;
  const [lastfm, city, userArtists, playlists, sync, email] =
    await dataPromise;
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
  // the Artists and Concerts tabs hide them behind their own view-side
  // filters. Pinned-city events ride along, kept per city, so the artist
  // cards can group upcoming concerts by the cities the user tracks - home
  // first, pins in order.
  const pinnedCities = collectPinnedCities(playlists, city);
  const [events, ...pinnedEventLists] = await Promise.all([
    fetchJson<UserEvent[]>(userEventsPath(), "events"),
    ...pinnedCities.map((pinnedCity) =>
      fetchJson<UserEvent[]>(userEventsPath(pinnedCity.geonameid), "events"),
    ),
  ]);
  const cityConcerts: CityConcerts[] = [
    { city, events },
    ...pinnedCities.map((pinnedCity, index) => ({
      city: pinnedCity,
      events: pinnedEventLists[index],
    })),
  ];

  const {
    knownArtists,
    suggestedArtists,
    knownOnlyArtists,
    artistRelations,
    artistsById,
  } = partitionArtists(userArtists);
  // Playlists appear only once they exist on Spotify; pins awaiting their
  // first sync are managed in Settings, not shown here.
  const linkedPlaylists = playlists.filter(
    (playlist) => playlist.spotify_url !== null,
  );
  const pinnedPlaylists = playlists.filter(
    (playlist) => playlist.city !== null,
  );
  const signature = settingsSignature(user, lastfm, city, knownArtists);
  const pendingPins = pendingPinIds(pinnedPlaylists);

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense>
        <QueryNotice notices={NOTICES} errors={ERRORS} />
      </Suspense>
      <div className="flex items-center justify-between gap-4">
        <h1 className="min-w-0 font-heading text-2xl font-semibold">NextFM</h1>
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
              label: "Artists",
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
                <ArtistsPanel
                  suggestedArtists={suggestedArtists}
                  knownArtists={knownOnlyArtists}
                  cityConcerts={cityConcerts}
                  synced={syncStepCompleted(sync, "suggestions")}
                />
              ),
            },
            {
              key: "concerts",
              label: "Concerts",
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
                  artistsById={artistsById}
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
                  Playlists
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
                />
              ),
            },
          ]}
        />
      </section>
      <SettingsDialog
        signature={signature}
        pendingPinIds={pendingPins}
        lastSyncedAt={user.last_synced_at}
      >
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
