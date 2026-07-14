"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

import { useSearchParams } from "next/navigation";

import {
  Tabs as TabsRoot,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { TAB_COOKIE } from "./tab-cookie";

// The key of the currently active tab, so a panel can tell when it's on
// screen. Panels stay mounted (forceMount) while hidden, and anything they
// portal out of the tree (e.g. a Popover) keeps rendering unless it checks;
// this is that check. Null outside a Tabs.
const ActiveTabContext = createContext<string | null>(null);

export function useActiveTab() {
  return useContext(ActiveTabContext);
}

export function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: {
    key: string;
    label: ReactNode;
    description?: string;
    // Right-justified companion to the description (e.g. the freshness
    // marker for the tab's sync step).
    note?: ReactNode;
    content: ReactNode;
  }[];
  defaultTab?: string;
}) {
  // The URL is the source of truth so the active tab follows browser and
  // in-app back/forward navigation. Without a ?tab= param, defaultTab (the
  // last selected tab, read from a cookie by the server component) applies -
  // being available server-side is what lets the page arrive already on the
  // right tab instead of flashing the first one and switching after mount.
  const tabParam = useSearchParams().get("tab");
  const requested = tabParam ?? defaultTab;
  const active =
    requested && tabs.some((tab) => tab.key === requested)
      ? requested
      : tabs[0].key;

  useEffect(() => {
    document.cookie = `${TAB_COOKIE}=${active}; path=/; max-age=31536000; samesite=lax`;
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
    <ActiveTabContext.Provider value={active}>
      <TabsRoot value={active} onValueChange={selectTab}>
        {/* flex-wrap only engages when the titles overflow (narrow screens):
            the list grows a second row and the sliding indicator follows the
            active tab there (it positions by offsetTop/offsetHeight). The
            trigger height pins the wrapped rows to the single-row height. */}
        <TabsList className="w-full gap-1 max-sm:h-auto max-sm:flex-wrap sm:w-fit">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="max-sm:h-[25px]"
            >
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
            {(tab.description || tab.note) && (
              <div
                key="description"
                className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1"
              >
                {tab.description && (
                  <p className="text-xs text-muted-foreground italic">
                    {tab.description}
                  </p>
                )}
                {tab.note && <div className="ml-auto">{tab.note}</div>}
              </div>
            )}
            <div key="content">{tab.content}</div>
          </TabsContent>
        ))}
      </TabsRoot>
    </ActiveTabContext.Provider>
  );
}
