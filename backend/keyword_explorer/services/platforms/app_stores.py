"""App Store Suggestions Fetcher (iOS & Mobile App Ecosystem)."""

from typing import List
import httpx
from .base import BasePlatformFetcher
from ...utils.normalization import sanitize_keyword


class AppStoresFetcher(BasePlatformFetcher):
    platform_id = "app_stores"
    display_name = "App Stores"
    category = "Mobile Applications"
    description = "Apple App Store software & application search keywords"

    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        url = "https://itunes.apple.com/search"
        params = {
            "term": query,
            "entity": "software",
            "country": country.lower(),
            "limit": 15,
        }
        try:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                results: List[str] = []
                for item in data.get("results", []):
                    title = item.get("trackName")
                    if title and isinstance(title, str):
                        clean_title = sanitize_keyword(title)
                        if clean_title:
                            results.append(clean_title)
                return results
            return []
        except Exception:
            return []

