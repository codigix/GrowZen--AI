"""Amazon Search Completion Fetcher."""

from typing import Dict, List
import httpx
from .base import BasePlatformFetcher
from ...utils.normalization import sanitize_keyword

AMAZON_MARKETPLACE_IDS: Dict[str, str] = {
    "US": "ATVPDKIKX0DER",
    "GB": "A1F83G8C2ARO7P",
    "UK": "A1F83G8C2ARO7P",
    "DE": "A1PA6795UKMFR9",
    "FR": "A13V1IB3VIYZZH",
    "CA": "A2EUQ1WTGCTBG2",
    "AU": "A39IBJ37TRP1C6",
    "IN": "A21TJRUUN4KGV",
    "JP": "A1VC38T7YXB528",
    "IT": "APJ6JRA9NG5V4",
    "ES": "A1RKKUPIHCS9HS",
}


class AmazonFetcher(BasePlatformFetcher):
    platform_id = "amazon"
    display_name = "Amazon"
    category = "E-Commerce"
    description = "Amazon product completion suggestions for commercial & buyer intent keywords"

    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        mid = AMAZON_MARKETPLACE_IDS.get(country.upper(), "ATVPDKIKX0DER")
        url = "https://completion.amazon.com/api/2017/suggestions"
        params = {
            "prefix": query,
            "mid": mid,
            "alias": "aps",
            "suggestion-type": "KEYWORD",
        }
        try:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                raw_suggestions = data.get("suggestions", [])
                results: List[str] = []
                for item in raw_suggestions:
                    val = item.get("value") if isinstance(item, dict) else None
                    if val and isinstance(val, str):
                        results.append(sanitize_keyword(val))
                if results:
                    return results

            # Fallback to US marketplace if localized mid yields no results
            if mid != "ATVPDKIKX0DER":
                params["mid"] = "ATVPDKIKX0DER"
                res_fallback = await client.get(url, params=params)
                if res_fallback.status_code == 200:
                    data = res_fallback.json()
                    return [
                        sanitize_keyword(item["value"])
                        for item in data.get("suggestions", [])
                        if isinstance(item, dict) and "value" in item
                    ]
            return []
        except Exception:
            return []

