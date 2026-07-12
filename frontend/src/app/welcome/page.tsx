import { redirect } from "next/navigation";

import { type City } from "../dashboard/city-panel";
import { type LastfmAccount } from "../dashboard/lastfm-panel";
import { fetchOptional, loadMe, loadSyncStatus } from "../dashboard/user-api";
import { IntroText } from "../intro-text";
import { WelcomeFlow } from "./welcome-flow";

export default async function WelcomePage() {
  const user = await loadMe();

  const [lastfm, city, sync] = await Promise.all([
    fetchOptional<LastfmAccount>("/me/lastfm", "Last.fm account"),
    fetchOptional<City>("/me/city", "city"),
    loadSyncStatus(),
  ]);

  // The flow only serves first-run users: once setup is complete and a full
  // sync has landed, there is nothing left to guide.
  if (lastfm !== null && city !== null && user.last_synced_at !== null) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-8">
      <span className="text-sm text-muted-foreground">NextFM</span>
      <h1 className="mt-2 text-2xl font-semibold">Welcome, {user.name}</h1>
      <IntroText className="mt-1 text-xs text-muted-foreground italic" />
      <div className="mt-6">
        <WelcomeFlow
          initialLastfm={lastfm}
          initialCity={city}
          initialSync={sync}
        />
      </div>
    </main>
  );
}
