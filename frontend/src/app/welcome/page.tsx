import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CityPanel, type City } from "../dashboard/city-panel";
import { LastfmPanel, type LastfmAccount } from "../dashboard/lastfm-panel";
import { Section } from "../dashboard/section";
import { SyncCard } from "../dashboard/sync-card";
import { fetchOptional, loadMe, loadSyncStatus } from "../dashboard/user-api";
import { IntroText } from "../intro-text";
import { Button } from "@/components/ui/button";

export default async function WelcomePage() {
  const user = await loadMe();

  const [lastfm, city, sync] = await Promise.all([
    fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
    fetchOptional<City>("/me/city", "city"),
    loadSyncStatus(),
  ]);

  // One pulsing dot marks the next step; completed steps get a check. The
  // sync step holds its check for a successful run, and shows no dot while
  // a run is already in progress (nothing to act on).
  const synced = user.last_synced_at !== null;
  const activeStep =
    lastfm === null
      ? "lastfm"
      : city === null
        ? "city"
        : !synced && sync?.status !== "running"
          ? "sync"
          : null;
  const stateFor = (
    step: string,
    done: boolean,
  ): "active" | "done" | undefined =>
    done ? "done" : activeStep === step ? "active" : undefined;

  // The settings cards, unchanged, in setup order; the state marks walk the
  // user through the steps, and the sync card runs and replays the first
  // sync (docs/design/2026-07-12-welcome-flow-plan.md). A finishing run's
  // refresh re-renders this page, revealing the all-set footer.
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center p-8">
      <span className="text-sm text-muted-foreground">NextFM</span>
      <h1 className="mt-2 text-2xl font-semibold">Welcome, {user.name}</h1>
      <IntroText className="mt-1 text-xs text-muted-foreground italic" />
      <div className="mt-6 space-y-6">
        <Section
          heading="Last.fm"
          state={stateFor("lastfm", lastfm !== null)}
          description="Listening history is imported from your Last.fm account."
        >
          <LastfmPanel account={lastfm} />
        </Section>
        <Section
          heading="Home City"
          state={stateFor("city", city !== null)}
          description="A playlist is generated for concerts in your home city."
        >
          <CityPanel city={city} />
        </Section>
        <Section
          heading="First Sync"
          state={stateFor("sync", synced)}
          description="Imports listening history, suggests artists, finds concerts and generates playlists."
        >
          <SyncCard lastfmLinked={lastfm !== null} citySet={city !== null} />
        </Section>
      </div>
      {user.last_synced_at !== null && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 animate-slide-in-up">
          <p className="text-sm">All set. Playlists update daily.</p>
          <Button asChild size="sm">
            <Link href="/dashboard">
              Go to dashboard
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
}
