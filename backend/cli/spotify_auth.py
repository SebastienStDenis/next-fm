"""Authorization of the bot Spotify account.

Prints the authorize URL; open it in a browser logged in as the bot account,
approve, then paste the URL Spotify redirected to back here. Prints the
refresh token to set as SPOTIFY_REFRESH_TOKEN. Re-run whenever the token
expires (Spotify expires refresh tokens after 6 months); the full runbook,
including the production side, is docs/operations.md.

Usage (from backend/): uv run python -m cli.spotify_auth
"""

import asyncio
import secrets
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from app.core.config import get_settings

AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
REDIRECT_URI = "http://127.0.0.1:8765/callback"
SCOPE = "playlist-modify-public playlist-modify-private playlist-read-private"


async def main() -> None:
    settings = get_settings()
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        raise SystemExit("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.")

    state = secrets.token_urlsafe(16)
    authorize_url = f"{AUTHORIZE_URL}?" + urlencode(
        {
            "client_id": settings.spotify_client_id,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "scope": SCOPE,
            "state": state,
        }
    )
    print(f"1. In the Spotify developer dashboard, make sure {REDIRECT_URI}")
    print("   is listed under the app's Redirect URIs.")
    print("2. Open this URL in a browser logged in as the bot account:\n")
    print(f"   {authorize_url}\n")
    print("3. Approve access. The browser will land on an unreachable")
    print(f"   {REDIRECT_URI}?code=... page; copy that full URL from the")
    print("   address bar and paste it below.\n")

    redirected = input("Redirected URL: ").strip()
    query = parse_qs(urlparse(redirected).query)
    if query.get("state", [None])[0] != state:
        raise SystemExit("State mismatch; run the flow again and paste the fresh URL.")
    if "error" in query:
        raise SystemExit(f"Authorization was denied: {query['error'][0]}")
    code = query.get("code", [None])[0]
    if not code:
        raise SystemExit("No ?code= found in that URL; paste the full redirected URL.")

    async with httpx.AsyncClient() as http:
        response = await http.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
            },
            auth=(settings.spotify_client_id, settings.spotify_client_secret),
        )
    if response.status_code >= 400:
        raise SystemExit(f"Token exchange failed ({response.status_code}): {response.text}")
    refresh_token = response.json().get("refresh_token")
    if not refresh_token:
        raise SystemExit(f"No refresh token in response: {response.text}")

    print(f"\nSPOTIFY_REFRESH_TOKEN={refresh_token}\n")
    print("Locally: add it to the root .env.")
    print("In production: set it in the Render `next-fm` env group, then")
    print("redeploy both next-fm-api and next-fm-worker - a running process")
    print("does not pick up an env group change on its own.")


if __name__ == "__main__":
    asyncio.run(main())
