"""DuckDuckGo Autosuggest Fetcher."""

from typing import List
import httpx
from .base import BasePlatformFetcher
from ...utils.normalization import sanitize_keyword


class DuckDuckGoFetcher(BasePlatformFetcher):
    platform_id = "duckduckgo"
    display_name = "DuckDuckGo"
    category = "Search Engine"
    description = "Privacy-focused DuckDuckGo autosuggest recommendations"

    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        url = "https://duckduckgo.com/ac/"
        params = {
            "q": query,
            "type": "list",
        }
        try:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                # DuckDuckGo returns either [query, [s1, s2]] or [{"phrase": "s1"}]
                if isinstance(data, list):
                    if len(data) > 1 and isinstance(data[1], list):
                        return [sanitize_keyword(item) for item in data[1] if isinstance(item, str)]
                    return [
                        sanitize_keyword(item["phrase"])
                        for item in data
                        if isinstance(item, dict) and "phrase" in item
                    ]
            return []
        except Exception:
            return []

