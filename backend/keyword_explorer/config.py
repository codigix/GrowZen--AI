"""Application configuration settings for Keyword Explorer FastAPI."""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_backend_dir = Path(__file__).resolve().parent.parent
_repo_root = _backend_dir.parent


class Settings(BaseSettings):
    """Configuration settings loaded from environment or .env file."""

    model_config = SettingsConfigDict(
        env_file=(_repo_root / ".env", _backend_dir / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Keyword Explorer API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Runtime & Concurrency (Parallel multi-platform execution)
    KEYWORD_API_TIMEOUT_SECONDS: float = 4.5
    KEYWORD_FETCH_CONCURRENCY: int = 20
    KEYWORD_PLATFORM_CONCURRENCY: int = 4
    KEYWORD_QUERY_LIMIT: int = 24

    # Default Localization
    DEFAULT_COUNTRY: str = "IN"
    DEFAULT_LANGUAGE: str = "en"

    # Cache Controls (in-memory TTL)
    KEYWORD_CACHE_TTL_SECONDS: int = 900


settings = Settings()
