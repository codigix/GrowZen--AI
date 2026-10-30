"""eBay Product Autosuggest Fetcher."""

import json
import re
from typing import List
import httpx
from .base import BasePlatformFetcher
from ...utils.normalization import sanitize_keyword


class EbayFetcher(BasePlatformFetcher):
    platform_id = "ebay"
    display_name = "eBay"
    category = "Marketplace"
    description = "eBay e-commerce autosuggest keyword discovery"

    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        url = "https://autosug.ebay.com/autosug"
        params = {
            "kwd": query,
            "sId": "0",
            "_jgr": "1",
        }
        try:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                text = response.text
                match = re.search(r"_do\((.*)\)", text)
                if match:
                    payload = json.loads(match.group(1))
                    raw_sug = payload.get("res", {}).get("sug", [])
                    return [sanitize_keyword(item) for item in raw_sug if isinstance(item, str)]
            return []
        except Exception:
            return []

