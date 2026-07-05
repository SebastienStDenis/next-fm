import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import Source


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class UserCreate(BaseModel):
    name: str = Field(min_length=1)


class LastfmAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    real_name: str | None
    avatar_url: str | None
    profile_url: str | None
    country: str | None
    registered_at: datetime | None
    playcount: int | None
    artist_count: int | None
    last_synced_at: datetime | None


class LastfmLink(BaseModel):
    username: str = Field(min_length=1)


class ArtistRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class ArtistInterestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: str
    source: Source
    evidence: dict
    created_at: datetime
    updated_at: datetime


class UserArtistRead(BaseModel):
    artist: ArtistRead
    interests: list[ArtistInterestRead]


class ArtistSyncKindResult(BaseModel):
    kind: str
    artists: int
    interests_created: int
    interests_updated: int
    interests_removed: int


class ArtistSyncResult(BaseModel):
    synced_at: datetime
    results: list[ArtistSyncKindResult]
