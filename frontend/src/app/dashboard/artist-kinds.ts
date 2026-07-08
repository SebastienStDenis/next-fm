// Interest-kind vocabulary, mirroring backend/app/matching.py. Lives outside
// any "use client" module so server components get real values, not client
// references.
export const KNOWN_ARTIST_KINDS = new Set([
  "lastfm_top_artist",
  "lastfm_loved_tracks",
]);
export const SIMILAR_ARTIST_KIND = "similar_artist";
