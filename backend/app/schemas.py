import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import Source


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    include_known_artists: bool


class UserCreate(BaseModel):
    name: str = Field(min_length=1)


class UserUpdate(BaseModel):
    include_known_artists: bool | None = None


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
    weight: float | None
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
    artists_failed: int
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


class SuggestionSyncResult(BaseModel):
    synced_at: datetime
    seeds_total: int
    seeds_synced: int
    seeds_skipped: int
    seeds_failed: int
    candidates_scored: int
    suggestions_created: int
    suggestions_kept: int
    suggestions_removed: int


class PlaylistTrackRead(BaseModel):
    position: int
    spotify_track_id: str
    title: str | None
    artist: ArtistRead | None
    event: EventRead | None
    url: str | None


class PlaylistRead(BaseModel):
    id: uuid.UUID
    kind: str
    name: str
    description: str | None
    city: CityRead | None
    spotify_playlist_id: str | None
    spotify_url: str | None
    last_synced_at: datetime | None
    tracks: list[PlaylistTrackRead]


class PlaylistCreate(BaseModel):
    geonameid: int


class PlaylistSyncItem(BaseModel):
    playlist_id: uuid.UUID
    name: str
    status: Literal["synced", "no_city"]
    created_remotely: bool = False
    tracks_added: int = 0
    tracks_removed: int = 0
    tracks_total: int = 0


class PlaylistSyncResult(BaseModel):
    synced_at: datetime
    artists_matched: int
    artists_resolved: int
    artists_unresolved: int
    top_tracks_refreshed: int
    playlists: list[PlaylistSyncItem]


SyncStepKey = Literal["artists", "suggestions", "events", "playlists"]


class SyncStepProgress(BaseModel):
    key: SyncStepKey
    label: str
    status: Literal["pending", "running", "completed", "failed"]
    summary: str | None = None


class SyncRunResult(BaseModel):
    steps: list[SyncStepProgress]


class SyncStartResult(BaseModel):
    workflow_id: str
    status: Literal["running"] = "running"


class SyncStatusResult(BaseModel):
    status: Literal["none", "running", "completed", "failed"]
    started_at: datetime | None = None
    finished_at: datetime | None = None
    steps: list[SyncStepProgress]
