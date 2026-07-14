// One-shot cue handed from the welcome flow to the dashboard's leading
// playlist tip. It lives in sessionStorage rather than the URL so it never
// bookmarks or shares and doesn't race the router on the welcome handoff; it
// survives a refresh and is cleared only when the user dismisses the tip.
// sessionStorage can be unavailable (privacy modes), so every access is guarded.
const KEY = "nextfm:save-playlist-tip";

export function cueSavePlaylistTip(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable - the tip just won't show */
  }
}

export function isSavePlaylistTipCued(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSavePlaylistTip(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable - nothing to clear */
  }
}
