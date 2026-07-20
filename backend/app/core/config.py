from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:54322/postgres"
    database_disable_prepared_statements: bool = False
    lastfm_api_key: str = ""
    bandsintown_api_key: str = ""
    spotify_client_id: str = ""
    spotify_client_secret: str = ""
    spotify_refresh_token: str = ""
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_task_queue: str = "user-sync"
    temporal_api_key: str = ""
    # Opt-in: the worker only keeps the nightly re-sync schedule when true, so
    # a local stack doesn't churn every user through the third-party APIs
    # overnight. Production must set it.
    nightly_sync_enabled: bool = False
    cors_origins: str = "http://localhost:3000"
    supabase_url: str = "http://127.0.0.1:54321"
    # Defaults to {supabase_url}/auth/v1; set only when the URL the backend
    # dials differs from the issuer in the tokens (compose containers).
    supabase_issuer: str = ""
    # Empty disables HS256 verification entirely; set it locally (CLI default
    # secret) and in production only if the project still signs with the
    # legacy JWT secret rather than asymmetric signing keys.
    supabase_jwt_secret: str = ""
    supabase_secret_key: str = ""
    log_level: str = "INFO"
    # Empty disables error reporting entirely, which is what a local stack
    # wants; the api and worker services share one DSN and are told apart by
    # the `component` tag.
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    # Set by Render on every deploy; stamps events with the commit they came
    # from, so an error points at the deploy that introduced it.
    render_git_commit: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
