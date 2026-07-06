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


class CityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    geonameid: int
    name: str
    admin1: str | None
    country_code: str
    latitude: float
    longitude: float


class CitySet(BaseModel):
    geonameid: int


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


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    venue_name: str
    venue_latitude: float
    venue_longitude: float
    city_name: str
    region: str | None
    country: str | None
    starts_at: datetime


class UserEventRead(BaseModel):
    event: EventRead
    url: str | None
    distance_km: float
    artists: list[ArtistRead]


class EventSyncResult(BaseModel):
    synced_at: datetime
    artists_total: int
    artists_synced: int
    artists_skipped: int
    artists_unknown: int
    events_created: int
    events_updated: int
    events_removed: int


class ArtistSyncKindResult(BaseModel):
    kind: str
    artists: int
    interests_created: int
    interests_updated: int
    interests_removed: int


class ArtistSyncResult(BaseModel):
    synced_at: datetime
    results: list[ArtistSyncKindResult]
