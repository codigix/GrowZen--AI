"""Application configuration, loaded from environment variables / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    pagespeed_api_key: str = ""
    pagespeed_enabled: bool = True
    local_lighthouse_enabled: bool = True

    audit_timeout_seconds: int = 180
    # Local Lighthouse launches a real Chrome process per audit (CPU/RAM
    # heavy), so this stays conservative by default.
    max_concurrent_audits: int = 2
    # PageSpeed Insights audits run on Google's infrastructure -- this
    # process only makes an HTTP call and waits, so a much higher number of
    # them can safely run concurrently without straining local resources.
    max_concurrent_pagespeed_audits: int = 8

    database_url: str = "sqlite:///./audits.db"
    reports_dir: str = "./reports"

    rate_limit_per_minute: int = 10

    host: str = "127.0.0.1"
    port: int = 8000

    @property
    def reports_path(self) -> Path:
        path = Path(self.reports_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def pagespeed_configured(self) -> bool:
        return bool(self.pagespeed_api_key) and self.pagespeed_enabled


@lru_cache
def get_settings() -> Settings:
    return Settings()
