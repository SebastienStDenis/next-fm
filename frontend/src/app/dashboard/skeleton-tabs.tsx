"use client";

import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "suggested", label: "Artists" },
  { key: "concerts", label: "Concerts" },
  { key: "playlists", label: "Playlists" },
];

// A static stand-in for the dashboard's tab strip. It resolves the active tab
// the same way Tabs does (?tab= first, then the last-tab cookie), so the pill
// is already on the right tab when the page replaces the skeleton.
export function SkeletonTabs({ defaultTab }: { defaultTab?: string }) {
  const requested = useSearchParams().get("tab") ?? defaultTab;
  const active = TABS.some((tab) => tab.key === requested)
    ? requested
    : TABS[0].key;

  return (
    <div className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-muted p-[3px] text-muted-foreground max-sm:h-auto max-sm:flex-wrap sm:w-fit dark:bg-black/25">
      {TABS.map((tab) => (
        <span
          key={tab.key}
          className={cn(
            "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center rounded-md px-1.5 py-0.5 text-sm font-medium whitespace-nowrap max-sm:h-[25px]",
            tab.key === active
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-foreground/60 dark:text-muted-foreground",
          )}
        >
          {tab.label}
        </span>
      ))}
    </div>
  );
}
