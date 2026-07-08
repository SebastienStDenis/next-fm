import Link from "next/link";

import { KNOWN_ARTIST_KINDS, SIMILAR_ARTIST_KIND } from "./artist-kinds";
import { AttentionDot } from "./attention-dot";
import { type City } from "./city-panel";
import { EventsPanel, type UserEvent } from "./events-panel";
import { type LastfmAccount } from "./lastfm-panel";
import { PlaylistsPanel, type Playlist } from "./playlists-panel";
import { SignOutButton } from "./sign-out-button";
import { SuggestedArtistsPanel } from "./suggested-artists-panel";
import { Tabs } from "./tabs";
import { type UserArtist } from "./taste-panel";
import { fetchJson, fetchOptional, loadMe, loadNeverSynced } from "./user-api";

export default async function DashboardPage() {
  const user = await loadMe();

  const [lastfm, city, userArtists, playlists, neverSynced] =
    await Promise.all([
      fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
      fetchOptional<City>("/me/city", "city"),
      fetchJson<UserArtist[]>("/me/artists", "user artists"),
      fetchJson<Playlist[]>("/me/playlists", "playlists"),
      loadNeverSynced(),
    ]);

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
  const suggestedArtists = userArtists.filter((userArtist) =>
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
    <main className="mx-auto max-w-xl p-8">
      <SignOutButton />
      <div className="mt-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Hey, {user.name}</h1>
        <Link
          href="/dashboard/account"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-600 transition-colors hover:border-foreground hover:text-foreground dark:border-gray-700 dark:text-gray-400"
        >
          {(lastfm === null || city === null || neverSynced) && <AttentionDot />}
          Account settings
          <span aria-hidden>&rarr;</span>
        </Link>
      </div>
      <p className="mt-1 text-xs text-gray-500 italic">
        We find upcoming concerts near you by artists that match your taste, and
        generate Spotify playlists for you to discover them.
      </p>
      <section className="mt-6">
        <Tabs
          tabs={[
            {
              key: "suggested",
              label: `Suggested artists (${suggestedArtists.length})`,
              description:
                "Artists we think you'll like based on your listening history.",
              content: (
                <SuggestedArtistsPanel suggestedArtists={suggestedArtists} />
              ),
            },
            {
              key: "concerts",
              label: `Concerts (${suggestedEventCount})`,
              description: "Upcoming shows near you by suggested artists.",
              content: (
                <EventsPanel
                  city={city}
                  hasArtists={userArtists.length > 0}
                  hasSuggestions={suggestedArtists.length > 0}
                  artistRelations={artistRelations}
                  events={events}
                />
              ),
            },
            {
              key: "playlists",
              label: `Playlists (${linkedPlaylists.length})`,
              description:
                "Spotify playlists tracking suggested shows in your cities.",
              content: (
                <PlaylistsPanel
                  hasCity={city !== null}
                  hasArtists={userArtists.length > 0}
                  playlists={linkedPlaylists}
                />
              ),
            },
          ]}
        />
      </section>
    </main>
  );
}
