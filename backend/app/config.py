"""Settings, read from environment variables (or a .env file next to the project)."""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_backend_dir = Path(__file__).resolve().parent.parent
_repo_root = _backend_dir.parent
_default_db = f"sqlite:///{(_backend_dir / 'seo_platform_dev.db').as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # One .env shared by the whole repo (backend/frontend/google_trends all read the same file).
        env_file=(_backend_dir / ".env", _repo_root / ".env", ".env"),
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
    admin_password: str = ""  # first start only; empty = a random one is generated and logged once (never a default in the source)
    admin_name: str = "Admin"

    # Database: its own PostgreSQL database in prod; SQLite for local dev out of the box.
    database_url: str = _default_db

    @field_validator("database_url")
    @classmethod
    def _psycopg3(cls, url: str) -> str:
        """The installed PostgreSQL driver is psycopg 3 (requirements.txt); a `postgresql://` or `+psycopg2` URL means that one."""
        for old in ("postgresql+psycopg2://", "postgresql://", "postgres://"):
            if url.startswith(old):
                return "postgresql+psycopg://" + url[len(old):]
        return url


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
    ai_provider: str = "deepseek"  # deepseek | openai | gemini | llamacpp (a local llama.cpp server: LLAMACPP_BASE_URL)
    llamacpp_base_url: str = "http://localhost:8080/v1"
    llamacpp_model: str = "local"
    deepseek_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    # Blog article generation (AI Blog Studio): local Ollama, same settings as the auto-blogger project.
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    ollama_max_tokens: int = 2048
    ollama_timeout_seconds: int = 180
    ollama_temperature: float = 0.6  # lower = steadier wording; the keyword "Regenerate" call raises it for variety
    ollama_num_ctx: int = 2048  # context window; 4096 fits a 3B model comfortably in 8 GB RAM
    ollama_prompt_persona: str = "You are an experienced SEO blog writer. Write clearly and helpfully, in simple English."
    ollama_prompt_requirements: str = "- Keep paragraphs short."
    # WordPress REST API (Application Password) for pushing a generated article as a draft; optional.
    site_autodetect: bool = True  # read a website's technology in the background when a business is created or its website changes
    wordpress_url: str = ""
    wordpress_user: str = ""
    wordpress_app_password: str = ""
    # Blog featured images: refuse to publish an article without one when true (BLOG_FEATURED_IMAGE_REQUIRED=true)
    blog_featured_image_required: bool = False
    # Extra engines for the GEO / AEO tracker (optional)
    perplexity_api_key: str = ""
    anthropic_api_key: str = ""
    claude_model: str = "claude-haiku-5-5"
    claude_timeout_seconds: int = 90

    # Google Ads Keyword Planner (keyword volume, competition, CPC bid ranges)
    google_ads_developer_token: str = ""
    google_ads_client_id: str = ""
    google_ads_client_secret: str = ""
    google_ads_refresh_token: str = ""
    google_ads_customer_id: str = ""  # the Google Ads account id (digits only, no dashes)

    # Our own deployed backlink crawler (https://crawler.codigixinfotech.com). Both must be set to use it.
    crawler_url: str = ""
    crawler_api_key: str = ""
    crawler_auth_header: str = "X-API-Key"  # or "Authorization" (then the key is sent as "Bearer <key>")
    crawler_timeout_seconds: float = 30.0
    google_ads_login_customer_id: str = ""  # manager (MCC) account id, only needed if the account is managed

    # Moz API (Domain Authority, Page Authority, Spam Score, referring domains) for the Backlink Checker. Empty = those fields say 'not available'.
    moz_access_id: str = ""
    moz_secret_key: str = ""

    # Development only: the same for the Position Tracking landscape (generated rank checks).
    rank_landscape_mock: bool = False
    # TESTS AND DEMOS ONLY (ALLOW_SAMPLE_DATA=true): lets the data providers fall back to generated sample numbers when a key is missing. Off by default: with it off,
    # a missing key means "not available" (HTTP 503 / a failed audit with the reason), never invented rankings, keywords, backlinks, listings or AI mentions.
    allow_sample_data: bool = False

    # Our own sites (comma separated domains): these businesses are "internal", all others are clients. See services/domain_checks.py.
    internal_domains: str = "codigix.co,codigixinfotech.com"

    # Scheduler
    scheduler_enabled: bool = True
    backlink_autostart: bool = True  # onboarding starts the backlink sync from our crawler straight away (false: it only runs on its schedule)
    scheduler_tick_seconds: int = 300
    scheduled_posts_tick_seconds: int = 60  # how often articles scheduled in GrowZen are checked and published when due
    publish_timezone: str = "Asia/Kolkata"  # the time zone schedule dates/times are entered in (PUBLISH_TIMEZONE)
    # HTML websites: each site's deployment adapter and credentials (server side only, git-ignored; relative paths are
    # inside backend/). See docs/html-site-deployment.md.
    html_deploy_config: str = "html_deploy.json"
    backlink_bot_auto_enabled: bool = True  # set false to stop the 60s auto-tick; "Run now" in the UI still works

    # Lighthouse audits (/lighthouse/...): full Lighthouse reports from PageSpeed Insights (needs
    # PAGESPEED_API_KEY) or a local Lighthouse CLI (Node.js + `npm install -g lighthouse` + Chrome).
    lighthouse_pagespeed_enabled: bool = True
    lighthouse_local_enabled: bool = True
    lighthouse_timeout_seconds: int = 180
    lighthouse_max_concurrent_local: int = 2  # each run is a real Chrome process: keep it low
    lighthouse_max_concurrent_pagespeed: int = 8  # just an HTTP call to Google
    lighthouse_reports_dir: str = "./reports/lighthouse"  # raw JSON / HTML reports
    lighthouse_rate_limit_per_minute: int = 10  # new audits per user per minute

    # Guards that can be switched off in development
    login_max_failures: int = 5
    login_lockout_minutes: int = 15
    login_ip_max_failures: int = 20  # wrong passwords from one address, across all accounts, before it is locked out
    login_account_max_failures: int = 10  # wrong passwords for one account, from anywhere
    trust_proxy_headers: bool = False  # take the client address from X-Forwarded-For (only behind a proxy you control: otherwise anyone can fake it)
    csrf_origin_check: bool = True  # refuse cross-site POST/PUT/PATCH/DELETE (see security_headers.py)
    allow_insecure_dev: bool = False  # lets the server start with a weak SECRET_KEY: only for a throw-away development machine
    enforce_plan_limits: bool = True
    # PostgreSQL gives up on any single query after this many seconds (0 = no limit). Without it one slow query (the backlink graph is large) holds a request thread for minutes,
    # the pool fills, and every page spins: seen in practice. Schema changes and bulk jobs lift it for their own transaction.
    db_statement_timeout_seconds: int = 60
    schema_auto_sync: bool = True  # create missing tables and add missing nullable columns at start-up
    audit_retention_days: int = 180

    @property
    def secure_cookies(self) -> bool:
        return self.cookie_secure or self.public_base_url.lower().startswith("https://") or self.frontend_url.lower().startswith("https://")

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
    def rank_landscape_mock_on(self) -> bool:
        return self.rank_landscape_mock and self.allow_sample_data and self.environment.lower() != "production"

    @property
    def internal_domain_list(self) -> list[str]:
        return [d.strip().lower().removeprefix("www.") for d in self.internal_domains.split(",") if d.strip()]

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

    @property
    def crawler_enabled(self) -> bool:
        return bool(self.crawler_url.strip() and self.crawler_api_key.strip() and self.crawler_api_key.strip() != "your_api_key_here")

    @property
    def google_ads_enabled(self) -> bool:
        return bool(
            self.google_ads_developer_token
            and self.google_ads_client_id
            and self.google_ads_client_secret
            and self.google_ads_refresh_token
            and self.google_ads_customer_id
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
