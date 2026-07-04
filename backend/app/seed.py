import asyncio

from sqlalchemy import select

from app.db import session_factory
from app.models import User


async def seed() -> None:
    async with session_factory() as session:
        existing = await session.execute(select(User).limit(1))
        if existing.scalar_one_or_none() is not None:
            print("Users already seeded, skipping.")
            return
        session.add(User(name="Ada Lovelace"))
        await session.commit()
        print("Seeded 1 user.")


if __name__ == "__main__":
    asyncio.run(seed())
