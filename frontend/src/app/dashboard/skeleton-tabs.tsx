"use client";

import { useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { DASHBOARD_TABS } from "./dashboard-tabs";
import { CARD_GRID_CLASS } from "./empty-state";

// Placeholders hold off briefly before fading in, so a warm load that resolves
// quickly swaps straight to content instead of flashing a skeleton first.
const DEFERRED_FADE_IN_CLASS =
  "animate-fade-in [animation-delay:200ms] [animation-fill-mode:backwards]";

function CardGridSkeleton() {
  return (
    <ul aria-hidden className={CARD_GRID_CLASS}>
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex">
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
      ))}
    </ul>
  );
}

// A static stand-in for the dashboard's tab strip and the open tab. It
// resolves the active tab the same way Tabs does (?tab= first, then the
// default the server read from the last-tab cookie); the tab's contents are
// placeholders.
export function SkeletonTabs({ defaultTab }: { defaultTab: string }) {
  const requested = useSearchParams().get("tab") ?? defaultTab;
  const active =
    DASHBOARD_TABS.find((tab) => tab.key === requested) ?? DASHBOARD_TABS[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground max-sm:h-auto max-sm:flex-wrap sm:w-fit dark:bg-black/25">
        {DASHBOARD_TABS.map((tab) => (
          <span
            key={tab.key}
            className={cn(
              "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap max-sm:h-[25px]",
              tab.key === active.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground/60 dark:text-muted-foreground",
            )}
          >
            {tab.label}
          </span>
        ))}
      </div>
      <div className={DEFERRED_FADE_IN_CLASS}>
        <div className="mb-3 flex h-4 items-center">
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <CardGridSkeleton />
      </div>
    </div>
  );
}
