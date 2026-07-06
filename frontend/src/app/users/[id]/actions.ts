"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export type ActionState = {
  error: string | null;
};

export type SyncArtistsActionState = {
  error: string | null;
  summary: string | null;
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : fallback;
}

async function callApi(
  path: string,
  init: RequestInit,
  fallback: string,
  revalidate: string,
): Promise<ActionState> {
  const res = await fetch(`${apiUrl}${path}`, init);
  if (!res.ok) {
    return { error: await errorMessage(res, fallback) };
  }

  revalidatePath(revalidate);
  return { error: null };
}

export async function linkLastfm(
  userId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = formData.get("username");
  if (typeof username !== "string" || username.trim() === "") {
    return { error: "Enter a Last.fm username." };
  }

  return callApi(
    `/users/${userId}/lastfm`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim() }),
    },
    "Failed to link Last.fm account.",
    `/users/${userId}`,
  );
}

export async function refreshLastfm(userId: string): Promise<ActionState> {
  return callApi(
    `/users/${userId}/lastfm/refresh`,
    { method: "POST" },
    "Failed to refresh Last.fm account.",
    `/users/${userId}`,
  );
}

export async function unlinkLastfm(userId: string): Promise<ActionState> {
  return callApi(
    `/users/${userId}/lastfm`,
    { method: "DELETE" },
    "Failed to unlink Last.fm account.",
    `/users/${userId}`,
  );
}

export async function setCity(
  userId: string,
  geonameid: number,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}/city`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to set city.",
    `/users/${userId}`,
  );
}

export async function clearCity(userId: string): Promise<ActionState> {
  return callApi(
    `/users/${userId}/city`,
    { method: "DELETE" },
    "Failed to clear city.",
    `/users/${userId}`,
  );
}

type SyncArtistsResponse = {
  results: {
    kind: string;
    artists: number;
    interests_created: number;
    interests_updated: number;
    interests_removed: number;
  }[];
};

export async function syncLastfmArtists(
  userId: string,
): Promise<SyncArtistsActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/lastfm/artists/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    return {
      error: await errorMessage(res, "Failed to sync artists."),
      summary: null,
    };
  }

  const body: SyncArtistsResponse = await res.json();
  const artists = body.results.reduce((sum, r) => sum + r.artists, 0);
  const created = body.results.reduce((sum, r) => sum + r.interests_created, 0);
  const updated = body.results.reduce((sum, r) => sum + r.interests_updated, 0);
  const removed = body.results.reduce((sum, r) => sum + r.interests_removed, 0);
  const summary = `Synced ${artists} ${artists === 1 ? "artist" : "artists"} · ${created} added, ${updated} updated, ${removed} removed`;

  revalidatePath(`/users/${userId}`);
  return { error: null, summary };
}

type SyncSuggestionsResponse = {
  seeds_total: number;
  seeds_synced: number;
  seeds_skipped: number;
  seeds_failed: number;
  candidates_scored: number;
  suggestions_created: number;
  suggestions_kept: number;
  suggestions_removed: number;
};

export async function syncSuggestions(
  userId: string,
): Promise<SyncArtistsActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/suggestions/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    return {
      error: await errorMessage(res, "Failed to sync suggestions."),
      summary: null,
    };
  }

  const body: SyncSuggestionsResponse = await res.json();
  const failed = body.seeds_failed > 0 ? `, ${body.seeds_failed} failed` : "";
  const seeds = `${body.seeds_total} ${body.seeds_total === 1 ? "seed" : "seeds"} (${body.seeds_skipped} fresh${failed})`;
  const summary = `Scored ${body.candidates_scored} candidates from ${seeds} · ${body.suggestions_created} suggestions added, ${body.suggestions_kept} kept, ${body.suggestions_removed} removed`;

  revalidatePath(`/users/${userId}`);
  return { error: null, summary };
}

export async function setIncludeKnownArtists(
  userId: string,
  includeKnownArtists: boolean,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_known_artists: includeKnownArtists }),
    },
    "Failed to update the setting.",
    `/users/${userId}`,
  );
}

type SyncEventsResponse = {
  artists_total: number;
  artists_synced: number;
  artists_skipped: number;
  artists_unknown: number;
  artists_failed: number;
  events_created: number;
  events_updated: number;
  events_removed: number;
};

export async function syncEvents(
  userId: string,
): Promise<SyncArtistsActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/events/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    return {
      error: await errorMessage(res, "Failed to sync events."),
      summary: null,
    };
  }

  const body: SyncEventsResponse = await res.json();
  const failed = body.artists_failed > 0 ? `, ${body.artists_failed} failed` : "";
  const checked = `Checked ${body.artists_total} ${body.artists_total === 1 ? "artist" : "artists"} (${body.artists_skipped} fresh, ${body.artists_unknown} not on Bandsintown${failed})`;
  const summary = `${checked} · ${body.events_created} events added, ${body.events_updated} updated, ${body.events_removed} removed`;

  revalidatePath(`/users/${userId}`);
  return { error: null, summary };
}

type SyncPlaylistsResponse = {
  artists_matched: number;
  artists_resolved: number;
  artists_unresolved: number;
  top_tracks_refreshed: number;
  playlists: {
    status: string;
    created_remotely: boolean;
    tracks_added: number;
    tracks_removed: number;
    tracks_total: number;
  }[];
};

export async function syncPlaylists(
  userId: string,
): Promise<SyncArtistsActionState> {
  const res = await fetch(`${apiUrl}/users/${userId}/playlists/sync`, {
    method: "POST",
  });
  if (!res.ok) {
    return {
      error: await errorMessage(res, "Failed to sync playlists."),
      summary: null,
    };
  }

  const body: SyncPlaylistsResponse = await res.json();
  const synced = body.playlists.filter((p) => p.status === "synced");
  const added = synced.reduce((sum, p) => sum + p.tracks_added, 0);
  const removed = synced.reduce((sum, p) => sum + p.tracks_removed, 0);
  const unresolved =
    body.artists_unresolved > 0
      ? `, ${body.artists_unresolved} not found on Spotify`
      : "";
  const summary = `Synced ${synced.length} ${synced.length === 1 ? "playlist" : "playlists"} · ${added} tracks added, ${removed} removed · ${body.artists_matched} artists with shows nearby${unresolved}`;

  revalidatePath(`/users/${userId}`);
  return { error: null, summary };
}

export async function createCityPlaylist(
  userId: string,
  geonameid: number,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}/playlists`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geonameid }),
    },
    "Failed to create playlist.",
    `/users/${userId}`,
  );
}

export async function deletePlaylist(
  userId: string,
  playlistId: string,
): Promise<ActionState> {
  return callApi(
    `/users/${userId}/playlists/${playlistId}`,
    { method: "DELETE" },
    "Failed to delete playlist.",
    `/users/${userId}`,
  );
}

export async function deleteUser(userId: string): Promise<ActionState> {
  const result = await callApi(
    `/users/${userId}`,
    { method: "DELETE" },
    "Failed to delete user.",
    "/users",
  );
  if (result.error) {
    return result;
  }

  redirect("/users");
}
