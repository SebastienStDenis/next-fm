import uuid

import httpx


class SupabaseAdminError(Exception):
    pass


class SupabaseAdminClient:
    """Minimal GoTrue admin client, authorized by the project secret key."""

    def __init__(self, url: str, secret_key: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=f"{url}/auth/v1",
            headers={"apikey": secret_key, "Authorization": f"Bearer {secret_key}"},
        )

    async def delete_user(self, supabase_user_id: uuid.UUID) -> None:
        try:
            response = await self._client.delete(f"/admin/users/{supabase_user_id}")
        except httpx.HTTPError as exc:
            raise SupabaseAdminError(f"Supabase admin API unreachable: {exc}") from exc
        if response.status_code == 404:
            return
        if response.is_error:
            raise SupabaseAdminError(
                f"Failed to delete auth user: {response.status_code} {response.text}"
            )

    async def aclose(self) -> None:
        await self._client.aclose()
