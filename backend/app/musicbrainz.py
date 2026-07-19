import asyncio

import httpx

API_URL = "https://musicbrainz.org/ws/2"
USER_AGENT = "next-fm/0.1 (https://github.com/sebastien/next-fm)"
SPOTIFY_ARTIST_URL_PREFIX = "https://open.spotify.com/artist/"
REQUEST_INTERVAL = 1.0  # MusicBrainz allows 1 request/second per client


class MusicBrainzApiError(Exception):
    def __init__(self, status_code: int, message: str | None) -> None:
        super().__init__(f"MusicBrainz error {status_code}: {message}")
        self.status_code = status_code


class MusicBrainzClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(base_url=API_URL, headers={"User-Agent": USER_AGENT})
        self._throttle = asyncio.Lock()
        self._next_request_at = 0.0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get_artist_spotify_id(self, mbid: str) -> str | None:
        """Spotify artist id from the artist's MusicBrainz url relationships,
        or None when the MBID is unknown or carries no Spotify link."""
        response = await self._get(f"/artist/{mbid}", params={"inc": "url-rels", "fmt": "json"})
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise MusicBrainzApiError(response.status_code, response.text.strip() or None)
        for relation in response.json().get("relations") or []:
            resource = (relation.get("url") or {}).get("resource") or ""
            if resource.startswith(SPOTIFY_ARTIST_URL_PREFIX):
                spotify_id = resource.removeprefix(SPOTIFY_ARTIST_URL_PREFIX).split("?")[0]
                return spotify_id or None
        return None

    async def has_artist_named(self, name: str) -> bool:
        """Whether an artist entity exists whose name or alias equals the given
        name (case-insensitive). MusicBrainz models joint scrobble credits as
        artist credits, never entities, so entity existence separates real
        separator-bearing names ("Earth, Wind & Fire") from credit strings."""
        escaped = name.replace("\\", "\\\\").replace('"', '\\"')
        response = await self._get(
            "/artist",
            params={"query": f'artist:"{escaped}" OR alias:"{escaped}"', "limit": 5, "fmt": "json"},
        )
        if response.status_code >= 400:
            raise MusicBrainzApiError(response.status_code, response.text.strip() or None)
        wanted = name.casefold()
        for artist in response.json().get("artists") or []:
            names = [artist.get("name") or ""]
            names += [(alias.get("name") or "") for alias in artist.get("aliases") or []]
            if any(candidate.casefold() == wanted for candidate in names):
                return True
        return False

    async def _get(self, path: str, params: dict) -> httpx.Response:
        async with self._throttle:
            loop = asyncio.get_running_loop()
            delay = self._next_request_at - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            try:
                return await self._http.get(path, params=params)
            finally:
                self._next_request_at = loop.time() + REQUEST_INTERVAL
