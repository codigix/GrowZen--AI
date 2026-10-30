"""Bing Autosuggest Fetcher."""

from typing import List
import httpx
from .base import BasePlatformFetcher
from ...utils.normalization import sanitize_keyword


class BingFetcher(BasePlatformFetcher):
    platform_id = "bing"
    display_name = "Bing"
    category = "Search Engine"
    description = "Microsoft Bing autosuggest query recommendations"

    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        market = f"{language.lower()}-{country.upper()}"
        url = "https://api.bing.com/osjson.aspx"
        params = {
            "query": query,
            "market": market,
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

