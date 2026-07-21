from datetime import UTC, datetime

import httpx
from pydantic import BaseModel

API_URL = "https://ws.audioscrobbler.com/2.0/"
USER_NOT_FOUND_ERROR_CODE = 6
PRIVATE_DATA_ERROR_CODE = 17

# Bound every request so a slow or stalled Last.fm response can't hold an open
# connection long enough to eat a whole sync activity's budget.
REQUEST_TIMEOUT = 10.0

# Meta tags users apply to their own library rather than to describe the
# artist; filtered out wherever tags are shown.
TAG_BLOCKLIST = frozenset(
    {
        "seen live",
        "want to see live",
        "seen in concert",
        "favorites",
        "favourites",
        "favorite",
        "favourite",
        "my favorites",
        "my favourites",
        "favorite artists",
        "favourite artists",
        "albums i own",
        "vinyl",
        "vinyls i own",
        "cds i own",
        "under 2000 listeners",
        "female vocalists",
        "female vocalist",
        "male vocalists",
        "male vocalist",
        "all",
        "music",
        "good",
        "awesome",
        "amazing",
        "beautiful",
        "epic",
        "cool",
        "love",
        "loved",
        "legend",
        "genius",
        "goat",
        "lovely",
        "god",
        "sexy",
        "vibes",
        "nostalgic",
        "childhood",
        "my top songs",
        "check out",
        "spotify",
        "messymember10",
    }
)


def visible_tags(tags: list[str]) -> list[str]:
    return [tag for tag in tags if tag.casefold() not in TAG_BLOCKLIST]


class LastfmUserNotFoundError(Exception):
    pass


class LastfmArtistNotFoundError(Exception):
    pass


class LastfmPrivateDataError(Exception):
    def __init__(self, username: str | None) -> None:
        super().__init__(
            f"{username}'s listening history isn't public. "
            "Update visibility settings in Last.fm then try again."
        )
        self.username = username


class LastfmApiError(Exception):
    def __init__(self, code: int, message: str | None) -> None:
        super().__init__(f"Last.fm error {code}: {message}")
        self.code = code


class LastfmUserInfo(BaseModel):
    username: str
    real_name: str | None
    avatar_url: str | None
    profile_url: str | None
    country: str | None
    registered_at: datetime | None


class LastfmTopArtist(BaseModel):
    name: str
    url: str | None
    mbid: str | None
    playcount: int | None
    rank: int | None


class LastfmLovedTrack(BaseModel):
    title: str
    artist_name: str
    artist_url: str | None
    artist_mbid: str | None


class LastfmLovedTracksPage(BaseModel):
    tracks: list[LastfmLovedTrack]
    total_pages: int


class LastfmArtistTopTrack(BaseModel):
    title: str
    rank: int | None
    playcount: int | None


class LastfmSimilarArtistData(BaseModel):
    name: str
    mbid: str | None
    match: float


class LastfmArtistInfo(BaseModel):
    name: str
    url: str | None
    mbid: str | None
    listeners: int | None
    playcount: int | None
    tags: list[str]


class LastfmClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._http = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def get_user_info(self, username: str) -> LastfmUserInfo:
        payload = await self._get({"method": "user.getinfo", "user": username})
        return _parse_user_info(payload["user"])

    async def get_top_artists(
        self, username: str, period: str = "12month", limit: int = 50, page: int = 1
    ) -> list[LastfmTopArtist]:
        payload = await self._get(
            {
                "method": "user.gettopartists",
                "user": username,
                "period": period,
                "limit": limit,
                "page": page,
            }
        )
        return [_parse_top_artist(artist) for artist in _as_list(payload["topartists"], "artist")]

    async def get_loved_tracks(
        self, username: str, limit: int = 50, page: int = 1
    ) -> LastfmLovedTracksPage:
        payload = await self._get(
            {"method": "user.getlovedtracks", "user": username, "limit": limit, "page": page}
        )
        loved = payload["lovedtracks"]
        return LastfmLovedTracksPage(
            tracks=[_parse_loved_track(track) for track in _as_list(loved, "track")],
            total_pages=_int_or_none(loved.get("@attr", {}).get("totalPages")) or 1,
        )

    async def get_artist_top_tracks(
        self, artist: str, limit: int = 10
    ) -> list[LastfmArtistTopTrack]:
        """An artist's tracks ranked by global playcount, best first."""
        payload = await self._get_artist("artist.gettoptracks", artist, limit=limit)
        return [_parse_artist_top_track(track) for track in _as_list(payload["toptracks"], "track")]

    async def get_similar_artists(
        self, artist: str, limit: int = 100
    ) -> list[LastfmSimilarArtistData]:
        """Artists similar to the given one, with Last.fm's 0-1 match score."""
        payload = await self._get_artist("artist.getsimilar", artist, limit=limit)
        return [
            _parse_similar_artist(entry) for entry in _as_list(payload["similarartists"], "artist")
        ]

    async def get_artist_info(self, artist: str) -> LastfmArtistInfo:
        """An artist's profile: canonical url, global listening stats, and
        top tags ordered by prominence."""
        payload = await self._get_artist("artist.getinfo", artist)
        return _parse_artist_info(payload["artist"])

    async def _get_artist(self, method: str, artist: str, **params: int) -> dict:
        try:
            return await self._get({"method": method, "artist": artist, "autocorrect": 1, **params})
        except LastfmUserNotFoundError:
            # Error 6 means "not found" for whatever entity the method takes.
            raise LastfmArtistNotFoundError(artist) from None

    async def _get(self, params: dict) -> dict:
        params = {**params, "api_key": self._api_key, "format": "json"}
        response = await self._http.get(API_URL, params=params)
        payload = response.json()
        error = payload.get("error")
        if error == USER_NOT_FOUND_ERROR_CODE:
            raise LastfmUserNotFoundError(params.get("user"))
        if error == PRIVATE_DATA_ERROR_CODE:
            raise LastfmPrivateDataError(params.get("user"))
        if error is not None:
            raise LastfmApiError(error, payload.get("message"))
        response.raise_for_status()
        return payload


def _parse_user_info(user: dict) -> LastfmUserInfo:
    images = [image.get("#text") for image in user.get("image", [])]
    avatar_url = next((url for url in reversed(images) if url), None)

    registered_at = None
    unixtime = user.get("registered", {}).get("unixtime")
    if unixtime:
        registered_at = datetime.fromtimestamp(int(unixtime), tz=UTC)

    return LastfmUserInfo(
        username=user["name"],
        real_name=_text_or_none(user.get("realname")),
        avatar_url=avatar_url,
        profile_url=_text_or_none(user.get("url")),
        country=_text_or_none(user.get("country")),
        registered_at=registered_at,
    )


def _parse_top_artist(artist: dict) -> LastfmTopArtist:
    return LastfmTopArtist(
        name=artist["name"],
        url=_text_or_none(artist.get("url")),
        mbid=_text_or_none(artist.get("mbid")),
        playcount=_int_or_none(artist.get("playcount")),
        rank=_int_or_none(artist.get("@attr", {}).get("rank")),
    )


def _parse_loved_track(track: dict) -> LastfmLovedTrack:
    artist = track.get("artist", {})
    return LastfmLovedTrack(
        title=track["name"],
        artist_name=artist["name"],
        artist_url=_text_or_none(artist.get("url")),
        artist_mbid=_text_or_none(artist.get("mbid")),
    )


def _parse_artist_top_track(track: dict) -> LastfmArtistTopTrack:
    return LastfmArtistTopTrack(
        title=track["name"],
        rank=_int_or_none(track.get("@attr", {}).get("rank")),
        playcount=_int_or_none(track.get("playcount")),
    )


def _parse_artist_info(artist: dict) -> LastfmArtistInfo:
    stats = artist.get("stats") or {}
    return LastfmArtistInfo(
        name=artist["name"],
        url=_text_or_none(artist.get("url")),
        mbid=_text_or_none(artist.get("mbid")),
        listeners=_int_or_none(stats.get("listeners")),
        playcount=_int_or_none(stats.get("playcount")),
        tags=[tag["name"] for tag in _as_list(artist.get("tags") or {}, "tag")],
    )


def _parse_similar_artist(artist: dict) -> LastfmSimilarArtistData:
    return LastfmSimilarArtistData(
        name=artist["name"],
        mbid=_text_or_none(artist.get("mbid")),
        match=float(artist.get("match") or 0.0),
    )


def _as_list(container: dict, key: str) -> list[dict]:
    # Last.fm collapses single-element JSON arrays into a bare object.
    value = container.get(key, [])
    if isinstance(value, dict):
        return [value]
    return value


def _text_or_none(value: str | None) -> str | None:
    # Last.fm uses the literal string "None" for unset fields like country.
    if not value or value == "None":
        return None
    return value


def _int_or_none(value: str | None) -> int | None:
    return int(value) if value else None
