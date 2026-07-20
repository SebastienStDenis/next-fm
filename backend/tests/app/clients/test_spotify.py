import asyncio
import json
from urllib.parse import parse_qs

import httpx
import pytest

from app.clients.spotify import (
    ACCOUNTS_URL,
    SpotifyApiError,
    SpotifyArtistData,
    SpotifyAuthError,
    SpotifyClient,
    SpotifyTrackData,
    track_uri,
)


def make_client(
    api_responses: list[httpx.Response],
    refresh_token: str = "rt",
    token_responses: list[httpx.Response] | None = None,
) -> tuple[SpotifyClient, list[httpx.Request]]:
    requests: list[httpx.Request] = []
    api_iter = iter(api_responses)
    token_iter = iter(token_responses or [])
    token_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if str(request.url) == ACCOUNTS_URL:
            if token_responses is not None:
                return next(token_iter)
            nonlocal token_count
            token_count += 1
            return httpx.Response(
                200, json={"access_token": f"tok-{token_count}", "expires_in": 3600}
            )
        return next(api_iter)

    client = SpotifyClient("cid", "secret", refresh_token=refresh_token)
    client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client, requests


def token_requests(requests: list[httpx.Request]) -> list[httpx.Request]:
    return [r for r in requests if str(r.url) == ACCOUNTS_URL]


def api_requests(requests: list[httpx.Request]) -> list[httpx.Request]:
    return [r for r in requests if str(r.url) != ACCOUNTS_URL]


def ok(payload: dict) -> httpx.Response:
    return httpx.Response(200, json=payload)


async def test_mints_token_with_refresh_token_grant() -> None:
    client, requests = make_client([ok({})], refresh_token="my-refresh")

    await client.replace_playlist_items("p1", [])

    (token_request,) = token_requests(requests)
    form = parse_qs(token_request.content.decode())
    assert form == {"grant_type": ["refresh_token"], "refresh_token": ["my-refresh"]}
    assert token_request.headers["Authorization"].startswith("Basic ")


async def test_mints_token_with_client_credentials_when_no_refresh_token() -> None:
    client, requests = make_client([ok({})], refresh_token="")

    await client.replace_playlist_items("p1", [])

    (token_request,) = token_requests(requests)
    form = parse_qs(token_request.content.decode())
    assert form == {"grant_type": ["client_credentials"]}


async def test_caches_access_token_across_requests() -> None:
    client, requests = make_client([ok({}), ok({})])

    await client.replace_playlist_items("p1", [])
    await client.replace_playlist_items("p1", [])

    assert len(token_requests(requests)) == 1
    assert [r.headers["Authorization"] for r in api_requests(requests)] == [
        "Bearer tok-1",
        "Bearer tok-1",
    ]


async def test_remints_expired_token() -> None:
    client, requests = make_client(
        [ok({}), ok({})],
        token_responses=[
            httpx.Response(200, json={"access_token": "short", "expires_in": 1}),
            httpx.Response(200, json={"access_token": "fresh", "expires_in": 3600}),
        ],
    )

    await client.replace_playlist_items("p1", [])
    await client.replace_playlist_items("p1", [])

    assert len(token_requests(requests)) == 2
    assert [r.headers["Authorization"] for r in api_requests(requests)] == [
        "Bearer short",
        "Bearer fresh",
    ]


async def test_invalid_grant_points_to_reauth() -> None:
    client, _ = make_client(
        [],
        token_responses=[
            httpx.Response(
                400,
                json={"error": "invalid_grant", "error_description": "Refresh token revoked"},
            )
        ],
    )

    with pytest.raises(SpotifyAuthError, match="cli.spotify_auth"):
        await client.replace_playlist_items("p1", [])


async def test_401_remints_token_and_retries_once() -> None:
    client, requests = make_client([httpx.Response(401), ok({"snapshot_id": "s1"})])

    snapshot_id = await client.replace_playlist_items("p1", [])

    assert snapshot_id == "s1"
    assert len(token_requests(requests)) == 2
    assert api_requests(requests)[1].headers["Authorization"] == "Bearer tok-2"


async def test_second_401_raises_api_error() -> None:
    client, _ = make_client(
        [
            httpx.Response(401),
            httpx.Response(401, json={"error": {"status": 401, "message": "Bad token"}}),
        ]
    )

    with pytest.raises(SpotifyApiError, match="Bad token") as excinfo:
        await client.replace_playlist_items("p1", [])
    assert excinfo.value.status_code == 401


async def test_429_honors_retry_after_and_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    client, _ = make_client(
        [httpx.Response(429, headers={"Retry-After": "7"}), ok({"snapshot_id": "s1"})]
    )

    snapshot_id = await client.replace_playlist_items("p1", [])

    assert snapshot_id == "s1"
    assert sleeps == [7.0]


async def test_429_gives_up_after_max_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    client, _ = make_client([httpx.Response(429, headers={"Retry-After": "2"}) for _ in range(4)])

    with pytest.raises(SpotifyApiError) as excinfo:
        await client.replace_playlist_items("p1", [])

    assert excinfo.value.status_code == 429
    assert sleeps == [2.0, 2.0, 2.0]


async def test_429_fails_fast_on_long_ban(monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    client, _ = make_client([httpx.Response(429, headers={"Retry-After": "54741"})])

    with pytest.raises(SpotifyApiError) as excinfo:
        await client.replace_playlist_items("p1", [])

    assert excinfo.value.status_code == 429
    assert sleeps == []


async def test_search_artists_parses_items() -> None:
    client, requests = make_client(
        [
            ok(
                {
                    "artists": {
                        "items": [
                            {"id": "a1", "name": "Autechre", "popularity": 60},
                            {"id": "a2", "name": "Autechre Tribute"},
                        ]
                    }
                }
            )
        ]
    )

    artists = await client.search_artists("Autechre")

    assert artists == [
        SpotifyArtistData(id="a1", name="Autechre"),
        SpotifyArtistData(id="a2", name="Autechre Tribute"),
    ]
    params = api_requests(requests)[0].url.params
    assert params["type"] == "artist"
    assert params["q"] == "Autechre"


async def test_search_tracks_parses_items_with_nested_artists() -> None:
    client, requests = make_client(
        [
            ok(
                {
                    "tracks": {
                        "items": [
                            {
                                "id": "t1",
                                "name": "Windowlicker",
                                "artists": [{"id": "a1", "name": "Aphex Twin"}],
                            }
                        ]
                    }
                }
            )
        ]
    )

    tracks = await client.search_tracks("Windowlicker", "Aphex Twin")

    assert tracks == [
        SpotifyTrackData(
            id="t1",
            name="Windowlicker",
            artists=[SpotifyArtistData(id="a1", name="Aphex Twin")],
        )
    ]
    params = api_requests(requests)[0].url.params
    assert params["q"] == 'track:"Windowlicker" artist:"Aphex Twin"'


async def test_search_tracks_strips_quotes_from_field_filters() -> None:
    client, requests = make_client([ok({"tracks": {"items": []}})])

    await client.search_tracks('"Heroes"', "David Bowie")

    params = api_requests(requests)[0].url.params
    assert params["q"] == 'track:"Heroes" artist:"David Bowie"'


async def test_search_handles_missing_items() -> None:
    client, _ = make_client([ok({"artists": {}})])

    assert await client.search_artists("nobody") == []


async def test_create_playlist_maps_fields() -> None:
    client, requests = make_client(
        [
            ok(
                {
                    "id": "p1",
                    "external_urls": {"spotify": "https://open.spotify.com/playlist/p1"},
                    "snapshot_id": "s1",
                }
            )
        ]
    )

    playlist = await client.create_playlist("Live in Montreal", "Upcoming concerts")

    assert playlist.id == "p1"
    assert playlist.url == "https://open.spotify.com/playlist/p1"
    assert playlist.snapshot_id == "s1"
    (api_request,) = api_requests(requests)
    assert api_request.method == "POST"
    assert api_request.url.path == "/v1/me/playlists"
    assert json.loads(api_request.content) == {
        "name": "Live in Montreal",
        "description": "Upcoming concerts",
        "public": False,
    }


async def test_update_playlist_details_keeps_playlist_unlisted() -> None:
    client, requests = make_client([ok({})])

    await client.update_playlist_details("p1", "New name", "New description")

    (api_request,) = api_requests(requests)
    assert api_request.method == "PUT"
    assert api_request.url.path == "/v1/playlists/p1"
    assert json.loads(api_request.content) == {
        "name": "New name",
        "description": "New description",
        "public": False,
    }


async def test_replace_playlist_items_sends_uris() -> None:
    client, requests = make_client([ok({"snapshot_id": "s2"})])

    snapshot_id = await client.replace_playlist_items("p1", [track_uri("t1"), track_uri("t2")])

    assert snapshot_id == "s2"
    (api_request,) = api_requests(requests)
    assert api_request.method == "PUT"
    assert api_request.url.path == "/v1/playlists/p1/items"
    assert json.loads(api_request.content) == {"uris": ["spotify:track:t1", "spotify:track:t2"]}


async def test_list_own_playlist_ids_follows_pages() -> None:
    client, requests = make_client(
        [
            ok({"items": [{"id": "p1"}, {"id": "p2"}], "next": "https://api/next"}),
            ok({"items": [{"id": "p3"}], "next": None}),
        ]
    )

    ids = await client.list_own_playlist_ids()

    assert ids == ["p1", "p2", "p3"]
    first, second = api_requests(requests)
    assert first.url.path == "/v1/me/playlists"
    assert parse_qs(first.url.query.decode()) == {"limit": ["50"], "offset": ["0"]}
    assert parse_qs(second.url.query.decode()) == {"limit": ["50"], "offset": ["2"]}


async def test_list_own_playlist_ids_empty_account() -> None:
    client, requests = make_client([ok({"items": [], "next": None})])

    assert await client.list_own_playlist_ids() == []
    assert len(api_requests(requests)) == 1


async def test_api_error_uses_api_error_message() -> None:
    client, _ = make_client(
        [httpx.Response(404, json={"error": {"status": 404, "message": "Invalid playlist Id"}})]
    )

    with pytest.raises(SpotifyApiError, match="Invalid playlist Id") as excinfo:
        await client.replace_playlist_items("nope", [])
    assert excinfo.value.status_code == 404
