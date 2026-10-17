// The dashboard's tabs, in strip order, for the loading skeleton's stand-in
// strip; keep in step with the tabs the page renders.
export const DASHBOARD_TABS = [
  { key: "suggested", label: "Artists" },
  { key: "concerts", label: "Concerts" },
  { key: "playlists", label: "Playlists" },
] as const;

// Where the dashboard opens without a ?tab= param or a last-tab cookie.
export const DEFAULT_TAB = "playlists";
