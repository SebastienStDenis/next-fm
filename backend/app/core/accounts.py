"""Shared account lookups used by both the API and the Temporal activities."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import LastfmAccount, LastfmConnection


async def linked_lastfm_account(session: AsyncSession, user_id: uuid.UUID) -> LastfmAccount | None:
    result = await session.execute(
        select(LastfmAccount)
        .join(LastfmConnection, LastfmConnection.lastfm_account_id == LastfmAccount.id)
        .where(LastfmConnection.user_id == user_id)
    )
    return result.scalar_one_or_none()
