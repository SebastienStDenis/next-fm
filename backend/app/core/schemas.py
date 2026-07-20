import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.models import Source


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    include_known_artists: bool
    last_synced_at: datetime | None


class UserUpdate(BaseModel):
    include_known_artists: bool | None = None
    name: str | None = Field(default=None, max_length=50)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Name cannot be empty.")
        return stripped


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
    excluded: bool
    tags: list[str] = []
    listeners: int | None = None


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
    # Defaulted so Temporal can replay histories recorded before these fields.
    artists_enriched: int = 0
    artists_enrich_failed: int = 0


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
    # "deleted": the playlist row vanished mid-sync (the user removed it);
    # nothing was written and the remote side is already handled.
    status: Literal["synced", "no_city", "deleted"]
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
    # When the step reached its terminal state (completed or failed); never
    # set for steps that never got to run.
    finished_at: datetime | None = None


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


class TombstoneDrainResult(BaseModel):
    drained: int
    pending: int


class DispatchSyncsResult(BaseModel):
    dispatched: int
    succeeded: int
    failed: int
    skipped: int
    orphans_found: int = 0
    tombstones_drained: int = 0
    tombstones_pending: int = 0
