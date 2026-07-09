"use client";

import { type ReactNode } from "react";

import { useSearchParams } from "next/navigation";

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

  const selectTab = (key: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    // replaceState updates the URL without a server round-trip (panels stay
    // mounted) and keeps tab switches out of back/forward history, while still
    // syncing useSearchParams so `active` above reflects the change.
    window.history.replaceState(null, "", `?${params.toString()}`);
  };

  return (
    <div>
      <div
        role="tablist"
        className="flex gap-4 border-b border-gray-300 dark:border-gray-700"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => selectTab(tab.key)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${
              active === tab.key
                ? "border-foreground"
                : "border-transparent text-gray-500 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Inactive tabs stay mounted so their in-progress state (sync
          summaries, search inputs) survives switching. */}
      {tabs.map((tab) => (
        <div key={tab.key} hidden={active !== tab.key} className="mt-2">
          {tab.description && (
            <p key="description" className="mb-4 text-xs text-gray-500 italic">
              {tab.description}
            </p>
          )}
          <div key="content">{tab.content}</div>
        </div>
      ))}
    </div>
  );
}
