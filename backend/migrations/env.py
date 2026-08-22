import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import get_settings
from app.core.models import Base

# Database prerequisites the schema depends on but Alembic autogenerate can't
# express: the pg_trgm extension (backing the cities trigram indexes) and
# uuidv7() (a PostgreSQL 18 built-in used as every UUID primary key's default).
# Local dev runs PG18; managed hosts may run an older major (e.g. Supabase on
# 17), so define a SQL polyfill when the built-in is absent. Applied before every
# migration run so a fresh database has them before the schema is created.
_UUIDV7_POLYFILL = """
CREATE FUNCTION public.uuidv7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$
"""


def _ensure_prerequisites(connection: Connection) -> None:
    connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    # Match the exact zero-arg signature: PG18 ships uuidv7() and uuidv7(interval),
    # so the bare name is ambiguous to to_regproc and would falsely read as absent.
    native = connection.execute(text("SELECT to_regprocedure('uuidv7()') IS NOT NULL")).scalar()
    if not native:
        connection.execute(text(_UUIDV7_POLYFILL))


# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config
# ConfigParser %-interpolates values, so raw percent signs in the URL must be doubled
config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        _ensure_prerequisites(connection)
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
