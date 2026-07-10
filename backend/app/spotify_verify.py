"""Phase 0 of docs/design/2026-07-06-playlist-plan.md: empirically verify what the Spotify API
allows a development-mode Client ID, before trusting the design's assumptions.

Needs SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN in .env (run app.spotify_auth
first). Creates a throwaway playlist on the bot account, exercises the replace
write the sync rests on (including its added_at semantics), and unfollows the
playlist at the end.

Usage (from backend/): uv run python -m app.spotify_verify
"""

import asyncio

from app.config import get_settings
from app.spotify import SpotifyApiError, SpotifyClient, track_uri

CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    CHECKS.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}" + (f" - {detail}" if detail else ""))


async def expect_error(client: SpotifyClient, name: str, method: str, path: str, **kw) -> None:
    try:
        await client._request(method, path, **kw)
        check(name, False, "unexpectedly succeeded")
    except SpotifyApiError as exc:
        check(name, True, f"rejected with {exc.status_code}")


async def main() -> None:
    settings = get_settings()
    if not settings.spotify_refresh_token:
        raise SystemExit("Set SPOTIFY_REFRESH_TOKEN in .env first (run app.spotify_auth).")
    client = SpotifyClient(
        settings.spotify_client_id,
        settings.spotify_client_secret,
        settings.spotify_refresh_token,
    )
    try:
        await run_checks(client)
    finally:
        await client.aclose()

    print()
    failed = [name for name, passed, _ in CHECKS if not passed]
    if failed:
        raise SystemExit(f"{len(failed)} check(s) failed: {', '.join(failed)}")
    print(f"All {len(CHECKS)} checks passed.")


async def run_checks(client: SpotifyClient) -> None:
    print("Auth and search:")
    artists = await client.search_artists("Radiohead")
    check("artist search returns results", bool(artists))
    artist = next((a for a in artists if a.name == "Radiohead"), None)
    check("exact-name match present in results", artist is not None)
    raw = await client._request(
        "GET", "/search", params={"type": "artist", "q": "Radiohead", "limit": 10}
    )
    item = (raw.get("artists") or {}).get("items", [{}])[0]
    check(
        "popularity/followers stripped from artist objects",
        "popularity" not in item and "followers" not in item,
        "still present" if "popularity" in item else "",
    )

    tracks = await client.search_tracks("Karma Police", "Radiohead")
    check("track search returns results", bool(tracks))
    verified = [t for t in tracks if artist and any(a.id == artist.id for a in t.artists)]
    check("track candidates verify against artist id", bool(verified))

    print("Removed endpoints really are removed:")
    if artist:
        await expect_error(
            client, "artists/{id}/top-tracks gone", "GET", f"/artists/{artist.id}/top-tracks"
        )
        await expect_error(client, "batch /artists?ids= gone", "GET", f"/artists?ids={artist.id}")

    if len(verified) < 1 or not tracks:
        check("enough tracks to exercise playlist writes", False)
        return
    seeds = []
    for title in ("Karma Police", "No Surprises", "Reckoner"):
        found = await client.search_tracks(title, "Radiohead")
        seeds.extend(t.id for t in found[:1] if t.id not in seeds)
    if len(seeds) < 3:
        check("found 3 seed tracks", False, f"only {len(seeds)}")
        return

    print("Playlist lifecycle (throwaway playlist on the bot account):")
    playlist = await client.create_playlist(
        "next-fm API verification (safe to delete)",
        "Throwaway playlist created by app.spotify_verify.",
    )
    check("create playlist", bool(playlist.id), playlist.url or "")
    try:
        snapshot = await client.replace_playlist_items(playlist.id, [track_uri(t) for t in seeds])
        check("replace into empty playlist returns snapshot_id", snapshot is not None)
        before = await read_items(client, playlist.id)
        check("replace wrote all tracks in order", [i for i, _ in before] == seeds)

        await asyncio.sleep(2)
        # Reorder + removal in one replace: the semantics the sync rests on.
        await client.replace_playlist_items(playlist.id, [track_uri(seeds[2]), track_uri(seeds[0])])
        after = await read_items(client, playlist.id)
        check(
            "replace applied new order and removal", [i for i, _ in after] == [seeds[2], seeds[0]]
        )
        added_at = dict(before)
        check(
            "replace preserves added_at for surviving tracks",
            all(added_at[i] == a for i, a in after),
            f"{before} -> {after}" if not all(added_at[i] == a for i, a in after) else "",
        )

        await client.replace_playlist_items(playlist.id, [])
        check(
            "replace with empty list clears the playlist", not await read_items(client, playlist.id)
        )

        await client.update_playlist_details(
            playlist.id, "next-fm verification (renamed)", "Renamed by app.spotify_verify."
        )
        check("update playlist details", True)
    finally:
        await client.unfollow_playlist(playlist.id)
        print("  (throwaway playlist unfollowed)")


async def read_items(client: SpotifyClient, playlist_id: str) -> list[tuple[str, str]]:
    payload = await client._request(
        "GET",
        f"/playlists/{playlist_id}/items",
        params={"fields": "items(added_at,item(id))", "limit": 100},
    )
    return [
        (item["item"]["id"], item["added_at"])
        for item in payload.get("items", [])
        if item.get("item")
    ]


if __name__ == "__main__":
    asyncio.run(main())
