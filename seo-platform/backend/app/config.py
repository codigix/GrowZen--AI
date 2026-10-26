"""Settings, read from environment variables (or a .env file next to the project)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Service
    app_name: str = "Codigix SEO Platform"
    environment: str = "development"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3100"  # comma separated (the SEO frontend)
    public_base_url: str = "http://localhost:8100"  # where this API is reachable (OAuth callback)
    frontend_url: str = "http://localhost:3100"
    frontend_dist: str = "../frontend/dist"  # built frontend served by this API when present

    # Own login: session cookie signed with SECRET_KEY; first admin created on start.
    secret_key: str = "change-me"
    session_cookie: str = "seo_session"
    session_hours: int = 12
    cookie_secure: bool = False  # true behind HTTPS
    admin_email: str = ""
    admin_password: str = ""
    admin_name: str = "Admin"

    # Database: its own PostgreSQL database, nothing shared with the CRM.
    database_url: str = "postgresql+psycopg://seo:seo@localhost:5432/seo_platform_db"

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

    # Paid data (optional): DataForSEO for rank grids, keyword data, backlinks, citations.
    dataforseo_login: str = ""
    dataforseo_password: str = ""

    # Scheduler
    scheduler_enabled: bool = True
    scheduler_tick_seconds: int = 300

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
