"""Platform suggestion fetchers package."""
from .base import BasePlatformFetcher
from .google import GoogleFetcher
from .youtube import YouTubeFetcher
from .bing import BingFetcher
from .amazon import AmazonFetcher
from .duckduckgo import DuckDuckGoFetcher
from .ebay import EbayFetcher
from .app_stores import AppStoresFetcher

PLATFORM_REGISTRY = {
    "google": GoogleFetcher(),
    "youtube": YouTubeFetcher(),
    "bing": BingFetcher(),
    "amazon": AmazonFetcher(),
    "duckduckgo": DuckDuckGoFetcher(),
    "ebay": EbayFetcher(),
    "app_stores": AppStoresFetcher(),
    "apple_app_store": AppStoresFetcher(),
}

__all__ = [
    "BasePlatformFetcher",
    "GoogleFetcher",
    "YouTubeFetcher",
    "BingFetcher",
    "AmazonFetcher",
    "DuckDuckGoFetcher",
    "EbayFetcher",
    "AppStoresFetcher",
    "PLATFORM_REGISTRY",
]
