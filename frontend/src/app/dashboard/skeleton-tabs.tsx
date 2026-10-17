"use client";

import { useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import * as artistSort from "./artist-sort";
import { DASHBOARD_TABS, type DashboardTabKey } from "./dashboard-tabs";
import { CARD_GRID_CLASS } from "./empty-state";
import * as eventSort from "./event-sort";
import { RelationFilterBar } from "./relation-filter-bar";

function ignore() {}

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

// The panels' filter row in its opening state, drawn by the real component
// and made inert: it looks exactly as it will, but nothing is wired up yet.
function FilterBarSkeleton<K extends string>({
  sort,
  className,
}: {
  sort: {
    DEFAULT_SORT_KEY: K;
    sortOptions: readonly { value: K; label: string }[];
  };
  className: string;
}) {
  return (
    <div inert>
      <RelationFilterBar
        showSuggested
        onShowSuggested={ignore}
        showKnown={false}
        onShowKnown={ignore}
        sortKey={sort.DEFAULT_SORT_KEY}
        onSortKey={ignore}
        sortOptions={sort.sortOptions}
        className={className}
      />
    </div>
  );
}

function PanelSkeleton({ tab }: { tab: DashboardTabKey }) {
  if (tab === "suggested") {
    return (
      <div>
        <FilterBarSkeleton sort={artistSort} className="mb-3" />
        <CardGridSkeleton />
      </div>
    );
  }
  if (tab === "concerts") {
    return (
      <div>
        <h3 className="flex flex-wrap items-center gap-x-1 gap-y-1 text-base font-semibold">
          <span>Upcoming concerts in</span>
          <Skeleton className="h-5 w-28" />
        </h3>
        <FilterBarSkeleton sort={eventSort} className="mt-3" />
        <div className="mt-3">
          <CardGridSkeleton />
        </div>
      </div>
    );
  }
  return <CardGridSkeleton />;
}

// A static stand-in for the dashboard's tab strip and the open tab. It
// resolves the active tab the same way Tabs does (?tab= first, then the
// default the server read from the last-tab cookie), and draws everything
// that doesn't depend on the user's data for real.
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
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4.5 gap-y-2">
          <p className="text-xs text-muted-foreground italic">
            {active.description}
          </p>
          <Skeleton className="h-4 w-40" />
        </div>
        <PanelSkeleton tab={active.key} />
      </div>
    </div>
  );
}
