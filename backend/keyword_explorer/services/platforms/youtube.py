"""YouTube Autocomplete Fetcher."""

from typing import List
import httpx
from .base import BasePlatformFetcher
from ...utils.normalization import sanitize_keyword


class YouTubeFetcher(BasePlatformFetcher):
    platform_id = "youtube"
    display_name = "YouTube"
    category = "Video Search"
    description = "Real-time YouTube video search suggestions for video SEO"

    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        url = "https://suggestqueries.google.com/complete/search"
        params = {
            "client": "firefox",
            "ds": "yt",
            "q": query,
            "hl": language.lower(),
            "gl": country.lower(),
        }
        try:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list):
                    return [sanitize_keyword(item) for item in data[1] if isinstance(item, str)]
            return []
        except Exception:
            return []

