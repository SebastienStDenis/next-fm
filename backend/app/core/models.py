import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Source(enum.StrEnum):
    """Where an interest row comes from: an external system we ingest data
    from, or our own suggestion engine."""

    LASTFM = "lastfm"
    BANDSINTOWN = "bandsintown"
    INTERNAL = "internal"


class Base(DeclarativeBase):
    pass


class City(Base):
    __tablename__ = "cities"

    geonameid: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    name: Mapped[str]
    ascii_name: Mapped[str]
    admin1: Mapped[str | None]
    country_code: Mapped[str]
    latitude: Mapped[float]
    longitude: Mapped[float]
    population: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


Index(
    "ix_cities_name_trgm",
    City.name,
    postgresql_using="gin",
    postgresql_ops={"name": "gin_trgm_ops"},
)
Index(
    "ix_cities_ascii_name_trgm",
    City.ascii_name,
    postgresql_using="gin",
    postgresql_ops={"ascii_name": "gin_trgm_ops"},
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    name: Mapped[str]
    supabase_user_id: Mapped[uuid.UUID | None] = mapped_column(unique=True, index=True)
    city_id: Mapped[int | None] = mapped_column(
        ForeignKey("cities.geonameid", ondelete="SET NULL"), index=True
    )
    include_known_artists: Mapped[bool] = mapped_column(default=False, server_default=false())
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


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
    similar_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    info_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LastfmSimilarArtist(Base):
    """Cached artist.getSimilar edges from a seed artist, global and shared
    across users. Targets are named by name_key, not FK: only candidates that
    become suggestions get canonical artist rows."""

    __tablename__ = "lastfm_similar_artists"
    __table_args__ = (UniqueConstraint("seed_artist_id", "name_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    seed_artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str]
    name_key: Mapped[str] = mapped_column(index=True)
    mbid: Mapped[str | None]
    match: Mapped[float]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class JointCreditVerdict(Base):
    """Cached joint-credit classification per candidate name, global across
    users: whether the suggestion filter judged the artist's name to be a
    Last.fm auto-created joint-credit page (known Last.fm issue, eg.
    'Turnstile & Blood Orange' as a single artist entity)."""

    __tablename__ = "joint_credit_verdicts"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    name: Mapped[str]
    name_key: Mapped[str] = mapped_column(unique=True)
    is_joint_credit: Mapped[bool]
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    title: Mapped[str | None]
    venue_name: Mapped[str]
    venue_latitude: Mapped[float]
    venue_longitude: Mapped[float]
    street_address: Mapped[str | None]
    city_name: Mapped[str]
    region: Mapped[str | None]
    country: Mapped[str | None]
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EventArtist(Base):
    __tablename__ = "event_artists"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TicketmasterEvent(Base):
    __tablename__ = "ticketmaster_events"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    external_id: Mapped[str] = mapped_column(unique=True)
    url: Mapped[str | None]
    lineup: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TicketmasterArtist(Base):
    __tablename__ = "ticketmaster_artists"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), unique=True
    )
    name: Mapped[str]
    external_id: Mapped[str | None]
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RaEvent(Base):
    __tablename__ = "ra_events"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    external_id: Mapped[str] = mapped_column(unique=True)
    url: Mapped[str | None]
    lineup: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RaArtist(Base):
    __tablename__ = "ra_artists"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), unique=True
    )
    name: Mapped[str]
    external_id: Mapped[str | None]
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
    weight: Mapped[float | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserArtistExclusion(Base):
    """User policy: never suggest, never seed, never match this artist.
    Durable, owned by no sync, never pruned."""

    __tablename__ = "user_artist_exclusions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SpotifyArtist(Base):
    __tablename__ = "spotify_artists"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), unique=True
    )
    spotify_id: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    match_confidence: Mapped[str]
    top_tracks_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ArtistTopTrack(Base):
    __tablename__ = "artist_top_tracks"
    __table_args__ = (UniqueConstraint("artist_id", "spotify_track_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), index=True
    )
    rank: Mapped[int]
    title: Mapped[str]
    spotify_track_id: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Playlist(Base):
    """A BEFORE DELETE trigger (playlists_tombstone, created in the
    add_spotify_playlist_tombstones migration) records spotify_playlist_id in
    spotify_playlist_tombstones whenever a row is deleted."""

    __tablename__ = "playlists"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "city_id", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str]
    city_id: Mapped[int | None] = mapped_column(ForeignKey("cities.geonameid", ondelete="CASCADE"))
    name: Mapped[str]
    description: Mapped[str | None]
    spotify_playlist_id: Mapped[str | None] = mapped_column(unique=True)
    spotify_url: Mapped[str | None]
    snapshot_id: Mapped[str | None]
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SyncRun(Base):
    """One execution of the sync pipeline for a user, queued by the API or the
    nightly dispatch and executed by the worker; the per-step progress is
    kept in the shape the status endpoint serves. At most one run per user
    is active (queued or running) at a time; a worker owns a run through
    `claim_id` and keeps `heartbeat_at` fresh while it executes.
    See docs/design/2026-08-16-postgres-sync-queue-plan.md."""

    __tablename__ = "sync_runs"
    __table_args__ = (
        Index(
            "ix_sync_runs_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        Index(
            "ix_sync_runs_active_created_at",
            "created_at",
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        Index("ix_sync_runs_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    trigger: Mapped[str]
    status: Mapped[str]
    steps: Mapped[list] = mapped_column(JSONB)
    error: Mapped[str | None]
    claim_id: Mapped[uuid.UUID | None]
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SpotifyPlaylistTombstone(Base):
    """A remote playlist id owed a delete in Spotify; rows are deleted once
    the Spotify delete lands. "delete" rows come from the playlists BEFORE
    DELETE trigger; "audit" rows are ids an audit found unclaimed."""

    __tablename__ = "spotify_playlist_tombstones"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    spotify_playlist_id: Mapped[str] = mapped_column(unique=True)
    source: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"
    __table_args__ = (UniqueConstraint("playlist_id", "spotify_track_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid7, server_default=func.uuidv7()
    )
    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]
    spotify_track_id: Mapped[str]
    artist_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("artists.id", ondelete="SET NULL")
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
