import { Brand } from "@/components/brand";
import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";

import { IntroText } from "../intro-text";
import { WELCOME_STEPS } from "./welcome-steps";

// The sync card's opening row as a user mid-setup sees it - a small button
// and a one-line note - laid out like the real row (same min height, gaps
// and note basis) so it wraps at the same widths and the vertically centered
// column doesn't shift when the page arrives.
function SyncCardSkeleton() {
  return (
    <div className="flex min-h-9 items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Skeleton className="h-7 w-33 shrink-0" />
        <div className="flex h-4 min-w-0 flex-1 basis-60 items-center">
          <Skeleton className="h-3 w-full max-w-64" />
        </div>
      </div>
    </div>
  );
}

// Mirrors the welcome page's column with its static copy drawn for real - the
// greeting, intro and each step's heading and description - and placeholders
// only where the user's data goes: their name and each step's card contents,
// sized like a user mid-setup sees them (the people who land here).
export default function Loading() {
  return (
    <main
      aria-busy
      className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center p-8"
    >
      <h1 className="text-2xl font-semibold">
        Welcome to <Brand />,{" "}
        <Skeleton className="inline-block h-6 w-24 align-middle" />
      </h1>
      <IntroText className="mt-1 text-xs text-muted-foreground italic" />
      <div className="mt-6 space-y-6">
        <Section
          heading={WELCOME_STEPS.lastfm.heading}
          description={WELCOME_STEPS.lastfm.description}
        >
          <Skeleton className="h-8 w-full" />
        </Section>
        <Section
          heading={WELCOME_STEPS.city.heading}
          description={WELCOME_STEPS.city.description}
        >
          <Skeleton className="h-8 w-full" />
        </Section>
        <Section
          heading={WELCOME_STEPS.sync.heading}
          description={WELCOME_STEPS.sync.description}
        >
          <SyncCardSkeleton />
        </Section>
      </div>
    </main>
  );
}
