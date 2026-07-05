import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
