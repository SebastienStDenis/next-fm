import { ArrowRight } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { AttentionDot } from "./attention-dot";
import { type City } from "./city-panel";
import { EventsPanel, type UserEvent } from "./events-panel";
import { type LastfmAccount } from "./lastfm-panel";
import { PlaylistsPanel, type Playlist } from "./playlists-panel";
import { SuggestedArtistsPanel } from "./suggested-artists-panel";
import { SyncedNote } from "./synced-note";
import { TAB_COOKIE } from "./tab-cookie";
import { Tabs } from "./tabs";
import { type UserArtist } from "./taste-panel";
import {
  fetchJson,
  fetchOptional,
  loadMe,
  loadSyncStatus,
  syncStepCompleted,
  syncStepCompletedAt,
} from "./user-api";

export default async function DashboardPage() {
  const user = await loadMe();
  const lastTab = (await cookies()).get(TAB_COOKIE)?.value;

  const [lastfm, city, userArtists, playlists, sync] = await Promise.all([
    fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
    fetchOptional<City>("/me/city", "city"),
    fetchJson<UserArtist[]>("/me/artists", "user artists"),
    fetchJson<Playlist[]>("/me/playlists", "playlists"),
    loadSyncStatus(),
  ]);
  // Also gates the "continually updated" pulse on playlists: a missing
  // Last.fm link or home city is what stops the nightly sync from
  // maintaining them.
  const syncDisabled = lastfm === null || city === null;

  // Known-artist events are fetched regardless of the user's global setting;
  // the events panel hides them behind its own view-side filter.
  const events =
    city !== null
      ? await fetchJson<UserEvent[]>(
          "/me/events?include_known_artists=true",
          "events",
        )
      : [];

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
  const suggestionsSyncedAt = syncStepCompletedAt(sync, "suggestions");
  const eventsSyncedAt = syncStepCompletedAt(sync, "events");
  const playlistsSyncedAt = syncStepCompletedAt(sync, "playlists");
  // Playlists appear only once they exist on Spotify; pins awaiting their
  // first sync are managed on the account page, not shown here.
  const linkedPlaylists = playlists.filter(
    (playlist) => playlist.spotify_url !== null,
  );
  // The tab count matches the panel's default view: suggested artists only.
  const suggestedEventCount = events.filter((userEvent) =>
    userEvent.artists.some(
      (artist) => artistRelations[artist.id] === "suggested",
    ),
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <span className="text-sm text-muted-foreground">NextFM</span>
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Hey, {user.name}</h1>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/dashboard/account">
            {syncDisabled && <AttentionDot pulse />}
            Account
            <ArrowRight aria-hidden />
          </Link>
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
              note: suggestionsSyncedAt && (
                <SyncedNote label="Suggest artists" iso={suggestionsSyncedAt} />
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
              note: eventsSyncedAt && (
                <SyncedNote label="Find concerts" iso={eventsSyncedAt} />
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
                  {!syncDisabled && linkedPlaylists.length > 0 && (
                    <span className="shrink-0 animate-fade-in" aria-hidden>
                      <span className="block size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-current" />
                    </span>
                  )}
                  Playlists ({linkedPlaylists.length})
                </>
              ),
              description:
                "Spotify playlists tracking suggested concerts in your cities.",
              note: playlistsSyncedAt && (
                <SyncedNote label="Generate playlists" iso={playlistsSyncedAt} />
              ),
              content: (
                <PlaylistsPanel
                  synced={syncStepCompleted(sync, "playlists")}
                  playlists={linkedPlaylists}
                  maintained={!syncDisabled}
                />
              ),
            },
          ]}
        />
      </section>
    </main>
  );
}
