import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Source(enum.StrEnum):
    """External systems we ingest data from."""

    LASTFM = "lastfm"


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    name: Mapped[str]


class LastfmAccount(Base):
    __tablename__ = "lastfm_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    username: Mapped[str]
    real_name: Mapped[str | None]
    avatar_url: Mapped[str | None]
    profile_url: Mapped[str | None]
    country: Mapped[str | None]
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    playcount: Mapped[int | None]
    artist_count: Mapped[int | None]
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


Index("ix_lastfm_accounts_username_lower", func.lower(LastfmAccount.username), unique=True)


class LastfmConnection(Base):
    __tablename__ = "lastfm_connections"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    lastfm_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lastfm_accounts.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Artist(Base):
    __tablename__ = "artists"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    name: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LastfmArtist(Base):
    __tablename__ = "lastfm_artists"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str]
    name_key: Mapped[str] = mapped_column(unique=True)
    url: Mapped[str | None]
    mbid: Mapped[str | None]
    listeners: Mapped[int | None] = mapped_column(BigInteger)
    playcount: Mapped[int | None] = mapped_column(BigInteger)
    tags: Mapped[list | None] = mapped_column(JSONB)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserArtistInterest(Base):
    __tablename__ = "user_artist_interests"
    __table_args__ = (UniqueConstraint("user_id", "artist_id", "kind"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str]
    source: Mapped[str]
    evidence: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
