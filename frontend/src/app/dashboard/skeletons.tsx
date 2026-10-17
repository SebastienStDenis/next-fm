import { Settings as SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { CARD_GRID_CLASS } from "./empty-state";
import { SkeletonTabs } from "./skeleton-tabs";

// Placeholders hold off briefly before fading in, so a warm load that resolves
// quickly swaps straight to content instead of flashing a skeleton first.
const DEFERRED_FADE_IN_CLASS =
  "animate-fade-in [animation-delay:200ms] [animation-fill-mode:backwards]";

function CardSkeleton() {
  return (
    <li className="flex">
      <Card className="flex-1">
        <CardHeader className="gap-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </CardHeader>
        <CardContent className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </CardContent>
      </Card>
    </li>
  );
}

// The dashboard's own frame - title, Settings button, tab strip - drawn for
// real so it doesn't move when the page arrives; only the data-backed parts
// are placeholders.
export function DashboardSkeleton({ defaultTab }: { defaultTab?: string }) {
  return (
    <main aria-busy className="mx-auto w-full max-w-5xl p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="min-w-0 font-heading text-2xl font-semibold">NextFM</h1>
        <Button variant="outline" size="sm" className="shrink-0" disabled>
          <SettingsIcon aria-hidden />
          Settings
        </Button>
      </div>
      <section className="mt-6 flex flex-col gap-2">
        <SkeletonTabs defaultTab={defaultTab} />
        <div className={DEFERRED_FADE_IN_CLASS}>
          <div className="mb-3 flex h-4 items-center">
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <ul aria-hidden className={CARD_GRID_CLASS}>
            {Array.from({ length: 6 }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
