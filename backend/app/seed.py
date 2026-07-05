import asyncio

from sqlalchemy import insert, select
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
    existing = await session.execute(select(City.geonameid).limit(1))
    if existing.scalar_one_or_none() is not None:
        print("Cities already seeded, skipping.")
        return
    cities = load_cities()
    await session.execute(insert(City), [dict(city) for city in cities])
    await session.commit()
    print(f"Seeded {len(cities)} cities.")


async def seed() -> None:
    async with session_factory() as session:
        await seed_users(session)
        await seed_cities(session)


if __name__ == "__main__":
    asyncio.run(seed())
