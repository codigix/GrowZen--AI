"""Settings, read from environment variables (or a .env file next to the project)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_backend_dir = Path(__file__).resolve().parent.parent
_repo_root = _backend_dir.parent
_default_db = f"sqlite:///{(_backend_dir / 'seo_platform_dev.db').as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # One .env shared by the whole repo (backend/frontend/google_trends all read the same file).
        env_file=(_repo_root / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service
    app_name: str = "Codigix SEO Platform"
    environment: str = "development"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3100,http://127.0.0.1:3100"  # comma separated (the SEO frontend)
    public_base_url: str = "http://localhost:8000"  # where this API is reachable (OAuth callback)
    frontend_url: str = "http://localhost:3100"
    frontend_dist: str = "../frontend/dist"  # built frontend served by this API when present

    # Own login: session cookie signed with SECRET_KEY; first admin created on start.
    secret_key: str = "change-me"
    session_cookie: str = "seo_session"
    session_hours: int = 12
    cookie_secure: bool = False  # true behind HTTPS
    admin_email: str = "info@codigixinfotech.com"
    admin_password: str = "Seo@1d86f6a045"
    admin_name: str = "Admin"

    # Database: its own PostgreSQL database in prod; SQLite for local dev out of the box.
    database_url: str = _default_db


    # Optional: also accept the CRM's session cookie (same JWT secret). The user's name, role and
    # department come from the CRM's /auth/me over HTTP, never from its database.
    crm_jwt_secret: str = ""
    crm_session_cookie: str = "crm_session"
    crm_api_url: str = "http://localhost:5002/api"
    allowed_departments: str = "testing,admin,management,seo"  # comma separated, matched loosely
    allowed_roles: str = "admin,super admin,tester"

    # Token encryption for stored Google refresh tokens (Fernet key, base64, 32 bytes).
    token_encryption_key: str = ""

    # Google (Business Profile, PageSpeed)
    google_client_id: str = ""
    google_client_secret: str = ""
    pagespeed_api_key: str = ""
    # Google Places API (New): find a business on Google Maps from an email / name (read-only)
    google_places_api_key: str = ""
    # Google Places API (New): used by the competitor finder (see app/competitors)
    google_api_key: str = ""
    # OpenStreetMap (Photon + Nominatim, no key): business-name suggestions and details while onboarding
    osm_lookup_enabled: bool = True

    # Onboarding email intake: a dedicated mailbox read over IMAP.
    intake_imap_host: str = ""
    intake_imap_port: int = 993
    intake_imap_user: str = ""
    intake_imap_password: str = ""
    intake_imap_folder: str = "INBOX"
    intake_allowed_senders: str = "codigixinfotech.com"  # addresses or domains, comma separated
    intake_webhook_token: str = ""  # for forwarding services that POST emails instead of IMAP

    # Notifications (optional SMTP)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # AI: OpenAI-compatible provider (deepseek | openai | gemini)
    ai_provider: str = "deepseek"
    deepseek_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    # Extra engines for the GEO / AEO tracker (optional)
    perplexity_api_key: str = ""
    anthropic_api_key: str = ""

    # Google search results (serper.dev): competitor research -- organic top 10 and Maps results per keyword
    serper_api_key: str = ""
    # Paid data (optional): DataForSEO for rank grids, keyword data, backlinks, citations.
    dataforseo_login: str = ""
    dataforseo_password: str = ""

    # Scheduler
    scheduler_enabled: bool = True
    scheduler_tick_seconds: int = 300

    # Lighthouse audits (/lighthouse/...): full Lighthouse reports from PageSpeed Insights (needs
    # PAGESPEED_API_KEY) or a local Lighthouse CLI (Node.js + `npm install -g lighthouse` + Chrome).
    lighthouse_pagespeed_enabled: bool = True
    lighthouse_local_enabled: bool = True
    lighthouse_timeout_seconds: int = 180
    lighthouse_max_concurrent_local: int = 2  # each run is a real Chrome process: keep it low
    lighthouse_max_concurrent_pagespeed: int = 8  # just an HTTP call to Google
    lighthouse_reports_dir: str = "./reports/lighthouse"  # raw JSON / HTML reports
    lighthouse_rate_limit_per_minute: int = 10  # new audits per user per minute

    @property
    def lighthouse_reports_path(self) -> Path:
        path = Path(self.lighthouse_reports_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def lighthouse_pagespeed_configured(self) -> bool:
        return bool(self.pagespeed_api_key) and self.lighthouse_pagespeed_enabled

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @staticmethod
    def _csv(value: str) -> list[str]:
        return [x.strip().lower() for x in value.split(",") if x.strip()]

    @property
    def allowed_department_list(self) -> list[str]:
        return self._csv(self.allowed_departments)

    @property
    def allowed_role_list(self) -> list[str]:
        return self._csv(self.allowed_roles)

    @property
    def intake_sender_list(self) -> list[str]:
        return self._csv(self.intake_allowed_senders)

    @property
    def dataforseo_enabled(self) -> bool:
        return bool(self.dataforseo_login and self.dataforseo_password)

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def imap_enabled(self) -> bool:
        return bool(self.intake_imap_host and self.intake_imap_user and self.intake_imap_password)

    @property
    def google_trends_enabled(self) -> bool:
        # The google_trends keyword planner now runs in-process (see services/google_trends_client.py),
        # so it's always available whenever this backend is.
        return True


@lru_cache
def get_settings() -> Settings:
    return Settings()
