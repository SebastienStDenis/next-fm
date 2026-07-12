import { redirect } from "next/navigation";

import { CityPanel, type City } from "../dashboard/city-panel";
import { LastfmPanel, type LastfmAccount } from "../dashboard/lastfm-panel";
import { Section } from "../dashboard/section";
import { SyncCard } from "../dashboard/sync-card";
import { fetchOptional, loadMe } from "../dashboard/user-api";
import { IntroText } from "../intro-text";

export default async function WelcomePage() {
  const user = await loadMe();

  const [lastfm, city] = await Promise.all([
    fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
    fetchOptional<City>("/me/city", "city"),
  ]);

  // The flow only serves first-run users: once setup is complete and a full
  // sync has landed, there is nothing left to guide. A finishing run's
  // refresh lands here too, handing the freshly synced user to the dashboard.
  if (lastfm !== null && city !== null && user.last_synced_at !== null) {
    redirect("/dashboard");
  }

  // The settings cards, unchanged, in setup order; their attention badges
  // walk the user through the steps, and the sync card runs and replays the
  // first sync (docs/design/2026-07-12-welcome-flow-plan.md).
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center p-8">
      <span className="text-sm text-muted-foreground">NextFM</span>
      <h1 className="mt-2 text-2xl font-semibold">Welcome, {user.name}</h1>
      <IntroText className="mt-1 text-xs text-muted-foreground italic" />
      <div className="mt-6 space-y-6">
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
          heading="First Sync"
          description="Imports listening history, suggests artists, finds concerts and generates playlists."
        >
          <SyncCard
            lastfmLinked={lastfm !== null}
            citySet={city !== null}
            defaultStepsExpanded
          />
        </Section>
      </div>
    </main>
  );
}
