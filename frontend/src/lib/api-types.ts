// API response shapes, mirroring the backend's Pydantic schemas
// (backend/app/core/schemas.py).

export type User = {
  id: string;
  name: string;
  include_known_artists: boolean;
  last_synced_at: string | null;
};

export type City = {
  geonameid: number;
  name: string;
  admin1: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
};

export type LastfmAccount = {
  id: string;
  username: string;
  real_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  country: string | null;
  registered_at: string | null;
  last_synced_at: string | null;
};

export type Artist = {
  id: string;
  name: string;
};

export type Interest = {
  kind: string;
  source: string;
  evidence: {
    rank?: number | null;
    playcount?: number | null;
    period?: string;
    track_count?: number;
    score?: number;
    paths?: { seed_artist_id: string; seed_name: string; match: number }[];
  };
  weight: number | null;
  created_at: string;
  updated_at: string;
};

export type UserArtist = {
  artist: Artist;
  interests: Interest[];
  excluded: boolean;
  tags: string[];
  listeners: number | null;
};

export type ArtistRelation = "known" | "suggested";

export type UserEvent = {
  event: {
    id: string;
    title: string | null;
    venue_name: string;
    venue_latitude: number;
    venue_longitude: number;
    city_name: string;
    region: string | null;
    country: string | null;
    starts_at: string;
  };
  url: string | null;
  distance_km: number;
  artists: Artist[];
};

export type Playlist = {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  city: City | null;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  last_synced_at: string | null;
  tracks: PlaylistTrack[];
};

export type PlaylistTrack = {
  position: number;
  spotify_track_id: string;
  title: string | null;
  artist: Artist | null;
  event: Pick<UserEvent["event"], "id" | "venue_name" | "starts_at"> | null;
  url: string | null;
};

export type SyncStepKey = "artists" | "suggestions" | "events" | "playlists";

export type SyncStep = {
  key: SyncStepKey;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  summary: string | null;
  // When the step reached its terminal state; null for steps that never ran.
  finished_at: string | null;
};

export type SyncStatus = {
  status: "none" | "running" | "completed" | "failed";
  started_at: string | null;
  finished_at: string | null;
  steps: SyncStep[];
};
