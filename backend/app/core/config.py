from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres"
    database_disable_prepared_statements: bool = False
    lastfm_api_key: str = ""
    ticketmaster_api_key: str = ""
    spotify_client_id: str = ""
    spotify_client_secret: str = ""
    spotify_refresh_token: str = ""
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "user-sync"
    temporal_api_key: str = ""
    nightly_sync_enabled: bool = False
    cors_origins: str = "http://localhost:3000"
    supabase_url: str = "http://127.0.0.1:54321"
    # Defaults to {supabase_url}/auth/v1; set only when the URL the backend
    # dials differs from the issuer in the tokens (compose containers).
    supabase_issuer: str = ""
    supabase_secret_key: str = ""
    log_level: str = "INFO"
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    render_git_commit: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
