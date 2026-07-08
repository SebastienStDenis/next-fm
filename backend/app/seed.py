import asyncio

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_factory
from app.geonames import load_cities
from app.models import City


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


async def seed() -> None:
    async with session_factory() as session:
        await seed_cities(session)


if __name__ == "__main__":
    asyncio.run(seed())
