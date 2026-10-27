"""Request bodies for the audit routers (one-off website audits, Lighthouse audits)."""
from typing import Literal

from pydantic import AnyUrl, BaseModel, Field, HttpUrl, field_validator


class WebsiteAuditIn(BaseModel):
    url: HttpUrl
    strategy: Literal["mobile", "desktop"] = "mobile"
    crawl_pages: int = Field(default=10, ge=1, le=50)


class LighthouseAuditIn(BaseModel):
    url: str = Field(description="Publicly reachable http(s) URL")
    strategy: Literal["mobile", "desktop"] = "mobile"
    engine: Literal["pagespeed", "lighthouse"] = "lighthouse"

    @field_validator("url")
    @classmethod
    def http_only(cls, v: str) -> str:
        # Not HttpUrl: that rewrites the URL (e.g. adds a trailing slash), and the URL is kept as typed.
        v = v.strip()
        if AnyUrl(v).scheme not in ("http", "https"):
            raise ValueError("Only http:// and https:// URLs are supported")
        return v


class LighthouseSiteAuditIn(BaseModel):
    url: str = Field(description="Site whose sitemap.xml lists the pages to audit")
    strategy: Literal["mobile", "desktop"] = "mobile"
    engine: Literal["pagespeed", "lighthouse"] = "lighthouse"
    max_pages: int = Field(default=10, ge=1, le=100)
