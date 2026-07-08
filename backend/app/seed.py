import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_factory
from app.geonames import load_cities
from app.models import City, User


async def seed_users(session: AsyncSession) -> None:
    existing = await session.execute(select(User).limit(1))
    if existing.scalar_one_or_none() is not None:
        print("Users already seeded, skipping.")
        return
    session.add(User(name="Ada Lovelace"))
    await session.commit()
    print("Seeded 1 user.")


async def seed_cities(session: AsyncSession) -> None:
    cities = load_cities()
    stmt = pg_insert(City)
    stmt = stmt.on_conflict_do_update(
        index_elements=[City.geonameid],
        set_={
            column.name: getattr(stmt.excluded, column.name)
            for column in City.__table__.columns
            if not column.primary_key
        },
    )
    await session.execute(stmt, [dict(city) for city in cities])
    await session.commit()
    print(f"Upserted {len(cities)} cities.")


async def seed(cities_only: bool = False) -> None:
    async with session_factory() as session:
        if not cities_only:
            await seed_users(session)
        await seed_cities(session)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed reference data.")
    parser.add_argument(
        "--cities-only",
        action="store_true",
        help="Load only the cities table, skipping the demo user (use in production).",
    )
    args = parser.parse_args()
    asyncio.run(seed(cities_only=args.cities_only))
