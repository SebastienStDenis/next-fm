"use client";

import { useEffect, type ReactNode } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Tabs as TabsRoot,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

const TAB_STORAGE_KEY = "dashboard-tab";

export function Tabs({
  tabs,
}: {
  tabs: {
    key: string;
    label: string;
    description?: string;
    content: ReactNode;
  }[];
}) {
  // The URL is the source of truth so the active tab follows browser and
  // in-app back/forward navigation, not just the value seeded on first render.
  const tabParam = useSearchParams().get("tab");
  const active =
    tabParam && tabs.some((tab) => tab.key === tabParam)
      ? tabParam
      : tabs[0].key;

  const router = useRouter();
  const pathname = usePathname();

  // When arriving without a ?tab= param (a plain link to the dashboard, like
  // the account page's Home link), restore the last active tab into the URL.
  // Explicit ?tab= links win. Declared before the persist effect below so the
  // stored value is read before it can be overwritten with the default. This
  // goes through the router (not history.replaceState like selectTab below)
  // because the router misses history API calls made while hydration is still
  // in flight, leaving useSearchParams stale.
  useEffect(() => {
    if (tabParam !== null) return;
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (stored !== null && tabs.some((tab) => tab.key === stored)) {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", stored);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [tabParam, tabs, router, pathname]);

  useEffect(() => {
    sessionStorage.setItem(TAB_STORAGE_KEY, active);
  }, [active]);

  const selectTab = (key: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    // replaceState updates the URL without a server round-trip (panels stay
    // mounted) and keeps tab switches out of back/forward history, while still
    // syncing useSearchParams so `active` above reflects the change.
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  return (
    <TabsRoot value={active} onValueChange={selectTab}>
      <TabsList className="w-full sm:w-fit">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* forceMount keeps inactive panels in the DOM so their in-progress
          state (sync summaries, search inputs) survives switching; the hidden
          attribute handles visibility instead. */}
      {tabs.map((tab) => (
        <TabsContent
          key={tab.key}
          value={tab.key}
          forceMount
          hidden={active !== tab.key}
        >
          {tab.description && (
            <p
              key="description"
              className="mb-4 text-xs text-muted-foreground italic"
            >
              {tab.description}
            </p>
          )}
          <div key="content">{tab.content}</div>
        </TabsContent>
      ))}
    </TabsRoot>
  );
}
