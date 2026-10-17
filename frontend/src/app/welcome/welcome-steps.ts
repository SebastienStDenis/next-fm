// The setup steps' card copy, in order. Shared by the welcome page and its
// loading skeleton so the two draw the same headings and descriptions.
export const WELCOME_STEPS = {
  lastfm: {
    heading: "Last.fm",
    description: "Listening history is imported from your Last.fm account.",
  },
  city: {
    heading: "Home City",
    description: "A playlist is generated for concerts in your home city.",
  },
  sync: {
    heading: "Daily Sync",
    description:
      "Imports listening history, suggests artists, finds concerts and generates playlists.",
  },
} as const;
