"""Phase 0 of docs/playlist-plan.md: empirically verify what the Spotify API
allows a development-mode Client ID, before trusting the design's assumptions.

Needs SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN in .env (run app.spotify_auth
first). Creates a throwaway playlist on the bot account, exercises the write
endpoints, checks the added_at semantics the delta-write design rests on, and
unfollows the playlist at the end.

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
        "live-playlists API verification (safe to delete)",
        "Throwaway playlist created by app.spotify_verify.",
    )
    check("create playlist", bool(playlist.id), playlist.url or "")
    try:
        snapshot = await client.add_playlist_items(playlist.id, [track_uri(t) for t in seeds])
        check("add items returns snapshot_id", snapshot is not None)

        before = await added_at_by_track(client, playlist.id)
        await asyncio.sleep(2)
        await client.reorder_playlist_items(playlist.id, 2, 0)
        after_reorder = await added_at_by_track(client, playlist.id)
        check(
            "reorder preserves added_at",
            before == after_reorder,
            f"{before} -> {after_reorder}" if before != after_reorder else "",
        )

        order = await client.get_playlist_track_ids(playlist.id)
        check("reorder moved the item", bool(order) and order[0] == seeds[2])

        await client._request(
            "PUT",
            f"/playlists/{playlist.id}/items",
            json={"uris": [track_uri(t) for t in seeds]},
        )
        after_replace = await added_at_by_track(client, playlist.id)
        # Verified July 2026: contrary to the community lore the plan cites,
        # full replace now PRESERVES added_at for surviving tracks. Deltas are
        # kept anyway - a no-op sync makes zero write calls.
        check(
            "full replace preserves added_at for surviving tracks",
            before == after_replace,
            f"{before} -> {after_replace}" if before != after_replace else "",
        )

        snapshot = await client.remove_playlist_items(playlist.id, [track_uri(seeds[0])])
        check("remove items returns snapshot_id", snapshot is not None)
        remaining = await client.get_playlist_track_ids(playlist.id)
        check(
            "removal removed exactly that track",
            seeds[0] not in remaining and len(remaining) == 2,
        )

        await client.update_playlist_details(
            playlist.id, "live-playlists verification (renamed)", "Renamed by app.spotify_verify."
        )
        check("update playlist details", True)
        remote_snapshot = await client.get_playlist_snapshot_id(playlist.id)
        check("snapshot_id readable via fields filter", remote_snapshot is not None)
    finally:
        await client.unfollow_playlist(playlist.id)
        print("  (throwaway playlist unfollowed)")


async def added_at_by_track(client: SpotifyClient, playlist_id: str) -> dict[str, str]:
    payload = await client._request(
        "GET",
        f"/playlists/{playlist_id}/items",
        params={"fields": "items(added_at,item(id))", "limit": 100},
    )
    return {
        item["item"]["id"]: item["added_at"]
        for item in payload.get("items", [])
        if item.get("item")
    }


if __name__ == "__main__":
    asyncio.run(main())
