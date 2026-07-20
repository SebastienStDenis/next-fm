from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_settings = get_settings()
# Supabase's transaction-mode pooler routes each transaction to a possibly
# different backend, so server-side prepared statements can't be reused there;
# disabling them stops psycopg from erroring. Off by default - the session-mode
# pooler and direct connections keep prepared statements.
_connect_args = (
    {"prepare_threshold": None} if _settings.database_disable_prepared_statements else {}
)

engine = create_async_engine(_settings.database_url, connect_args=_connect_args)
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session
