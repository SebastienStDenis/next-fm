// The dashboard's tabs, in strip order. Shared by the page and its loading
// skeleton so the two draw the same strip and copy.
export const DASHBOARD_TABS = [
  {
    key: "suggested",
    label: "Artists",
    description: "Artists you might like based on your listening history.",
  },
  {
    key: "concerts",
    label: "Concerts",
    description: "Upcoming concerts near you by suggested artists.",
  },
  {
    key: "playlists",
    label: "Playlists",
    description:
      "Spotify playlists tracking suggested concerts in your cities, updated daily.",
  },
] as const;

export type DashboardTabKey = (typeof DASHBOARD_TABS)[number]["key"];

// Where the dashboard opens without a ?tab= param or a last-tab cookie.
export const DEFAULT_TAB: DashboardTabKey = "playlists";

export function dashboardTab(key: DashboardTabKey) {
  return DASHBOARD_TABS.find((tab) => tab.key === key)!;
}
