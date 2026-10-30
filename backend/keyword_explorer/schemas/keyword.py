"""Pydantic models and schemas for Keyword Explorer."""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class KeywordSearchRequest(BaseModel):
    """Input payload for keyword research."""

    keyword: str = Field(
        ...,
        min_length=2,
        max_length=120,
        description="Seed keyword to expand (e.g. 'AI development company')",
        examples=["AI development company"],
    )
    country: str = Field(
        default="IN",
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code",
        examples=["IN"],
    )
    language: str = Field(
        default="en",
        min_length=2,
        max_length=8,
        description="Language code (e.g. 'en', 'es', 'fr')",
        examples=["en"],
    )
    platforms: List[str] = Field(
        default_factory=lambda: [
            "google",
            "youtube",
            "bing",
            "amazon",
            "duckduckgo",
            "ebay",
            "app_stores",
        ],
        description="Platforms to query",
        examples=[["google", "youtube", "bing", "amazon", "duckduckgo"]],
    )
    limit: int = Field(
        default=100,
        ge=1,
        le=500,
        description="Maximum number of keywords to return",
    )
    include_expansions: bool = Field(
        default=True,
        description="Whether to perform query expansion (seed + modifiers + alphabet)",
    )


class KeywordItem(BaseModel):
    """Keyword metrics record returning exclusively the required 7 fields."""

    keyword: str = Field(..., description="Discovered keyword text")
    trend: List[int] = Field(
        ...,
        description="12-month relative search volume trend",
    )
    search_volume: int = Field(
        ...,
        description="Monthly search volume",
    )
    intent: str = Field(
        default="INFORMATIONAL",
        description="Search intent (INFORMATIONAL, COMMERCIAL, TRANSACTIONAL, NAVIGATIONAL)",
    )
    competition: str = Field(
        default="MEDIUM",
        description="Competition intensity level (HIGH, MEDIUM, LOW)",
    )
    cpc: float = Field(
        default=0.0,
        description="Cost Per Click in USD",
    )
    difficulty: int = Field(
        default=0,
        ge=0,
        le=100,
        description="Keyword Difficulty score (0-100)",
    )


class PlatformInfo(BaseModel):
    """Information regarding a supported platform."""

    id: str
    name: str
    category: str
    is_free: bool
    status: Literal["active", "partial"]
    description: str


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    app: str
    version: str
    concurrency_limit: int
    cache_entries: int
