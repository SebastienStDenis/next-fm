import asyncio
import time

import httpx
from pydantic import BaseModel

ACCOUNTS_URL = "https://accounts.spotify.com/api/token"
API_URL = "https://api.spotify.com/v1"

SEARCH_LIMIT = 10  # development-mode hard cap
LIST_PLAYLISTS_LIMIT = 50  # /me/playlists page size cap
TOKEN_EXPIRY_MARGIN = 60.0
MAX_RATE_LIMIT_RETRIES = 3
MAX_RETRY_AFTER = 60.0


class SpotifyAuthError(Exception):
    """Token minting failed. `invalid_grant` means the refresh token expired
    (Spotify expires them after 6 months): re-run `python -m cli.spotify_auth`
    as the bot account and update SPOTIFY_REFRESH_TOKEN in .env."""


class SpotifyApiError(Exception):
    def __init__(self, status_code: int, message: str | None) -> None:
        super().__init__(f"Spotify error {status_code}: {message}")
        self.status_code = status_code


class SpotifyArtistData(BaseModel):
    id: str
    name: str


class SpotifyTrackData(BaseModel):
    id: str
    name: str
    artists: list[SpotifyArtistData]


class SpotifyPlaylistData(BaseModel):
    id: str
    url: str | None
    snapshot_id: str | None


def track_uri(track_id: str) -> str:
    return f"spotify:track:{track_id}"


class SpotifyClient:
    """Auth and HTTP for the Spotify Web API, as the app's bot account.

    Without a refresh token only app-level endpoints (search, entity lookups)
    work; playlist endpoints act on the bot account and need the user grant.
    """

    def __init__(self, client_id: str, client_secret: str, refresh_token: str = "") -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._access_token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()
        self._http = httpx.AsyncClient()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def search_artists(self, name: str) -> list[SpotifyArtistData]:
        """Search artists by name, in Spotify's own relevance order."""
        payload = await self._request(
            "GET",
            "/search",
            params={"type": "artist", "q": name, "limit": SEARCH_LIMIT},
        )
        items = (payload.get("artists") or {}).get("items") or []
        return [SpotifyArtistData.model_validate(item) for item in items]

    async def search_tracks(self, title: str, artist_name: str) -> list[SpotifyTrackData]:
        """Resolve a known track title + artist name to playable candidates."""
        query = f'track:"{_field_value(title)}" artist:"{_field_value(artist_name)}"'
        payload = await self._request(
            "GET",
            "/search",
            params={"type": "track", "q": query, "limit": SEARCH_LIMIT},
        )
        items = (payload.get("tracks") or {}).get("items") or []
        return [SpotifyTrackData.model_validate(item) for item in items]

    async def get_artist(self, spotify_id: str) -> SpotifyArtistData:
        payload = await self._request("GET", f"/artists/{spotify_id}")
        return SpotifyArtistData.model_validate(payload)

    async def create_playlist(self, name: str, description: str | None) -> SpotifyPlaylistData:
        payload = await self._request(
            "POST",
            "/me/playlists",
            json={"name": name, "description": description or "", "public": False},
        )
        return SpotifyPlaylistData(
            id=payload["id"],
            url=(payload.get("external_urls") or {}).get("spotify"),
            snapshot_id=payload.get("snapshot_id"),
        )

    async def replace_playlist_items(self, playlist_id: str, uris: list[str]) -> str | None:
        """Atomically replace the playlist's contents (max 100 URIs). Surviving
        tracks keep their added_at (verified July 2026, see cli.spotify_verify)."""
        payload = await self._request("PUT", f"/playlists/{playlist_id}/items", json={"uris": uris})
        return payload.get("snapshot_id")

    async def update_playlist_details(
        self, playlist_id: str, name: str, description: str | None
    ) -> None:
        # Re-asserting `public` on every details write converges any playlist
        # still flagged public on the bot account to unlisted.
        await self._request(
            "PUT",
            f"/playlists/{playlist_id}",
            json={"name": name, "description": description or "", "public": False},
        )

    async def unfollow_playlist(self, playlist_id: str) -> None:
        await self._request("DELETE", f"/playlists/{playlist_id}/followers")

    async def list_own_playlist_ids(self) -> list[str]:
        """Every playlist id on the bot account, paged - the ground truth the
        orphan audit diffs local state against."""
        ids: list[str] = []
        offset = 0
        while True:
            payload = await self._request(
                "GET",
                "/me/playlists",
                params={"limit": LIST_PLAYLISTS_LIMIT, "offset": offset},
            )
            items = payload.get("items") or []
            ids.extend(item["id"] for item in items if item)
            offset += len(items)
            if not items or payload.get("next") is None:
                return ids

    async def _request(
        self, method: str, path: str, params: dict | None = None, json: dict | None = None
    ) -> dict:
        retried_auth = False
        rate_limit_retries = 0
        while True:
            token = await self._get_access_token()
            response = await self._http.request(
                method,
                f"{API_URL}{path}",
                params=params,
                json=json,
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code == 401 and not retried_auth:
                retried_auth = True
                self._access_token = None
                continue
            if response.status_code == 429 and rate_limit_retries < MAX_RATE_LIMIT_RETRIES:
                retry_after = float(response.headers.get("Retry-After") or 1)
                if retry_after > MAX_RETRY_AFTER:
                    # A long ban (quota exhaustion announces hours): waiting
                    # our capped interval cannot help, so fail immediately.
                    raise SpotifyApiError(response.status_code, _error_message(response))
                rate_limit_retries += 1
                await asyncio.sleep(retry_after)
                continue
            if response.status_code >= 400:
                raise SpotifyApiError(response.status_code, _error_message(response))
            if not response.content:
                return {}
            return response.json()

    async def _get_access_token(self) -> str:
        async with self._token_lock:
            if self._access_token and time.monotonic() < self._token_expires_at:
                return self._access_token

            if self._refresh_token:
                data = {"grant_type": "refresh_token", "refresh_token": self._refresh_token}
            else:
                data = {"grant_type": "client_credentials"}
            response = await self._http.post(
                ACCOUNTS_URL, data=data, auth=(self._client_id, self._client_secret)
            )
            if response.status_code >= 400:
                message = _error_message(response)
                if "invalid_grant" in (message or ""):
                    raise SpotifyAuthError(
                        "Spotify refresh token was rejected (invalid_grant): it has likely "
                        "expired. Re-run `python -m cli.spotify_auth` as the bot account and "
                        "update SPOTIFY_REFRESH_TOKEN in .env."
                    )
                raise SpotifyAuthError(
                    f"Spotify token request failed ({response.status_code}): {message}"
                )
            payload = response.json()
            self._access_token = payload["access_token"]
            self._token_expires_at = (
                time.monotonic() + float(payload.get("expires_in") or 3600) - TOKEN_EXPIRY_MARGIN
            )
            return self._access_token


def _field_value(value: str) -> str:
    # Quotes can't be escaped inside a field filter; a title like "Heroes"
    # would otherwise break out of it and match nothing.
    return value.replace('"', "")


def _error_message(response: httpx.Response) -> str | None:
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip() or None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            return error.get("message")
        if isinstance(error, str):
            description = payload.get("error_description")
            return f"{error}: {description}" if description else error
    return None
