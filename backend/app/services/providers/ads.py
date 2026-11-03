"""Keyword ideas with real volume, CPC and difficulty from the Google Ads Keyword Planner."""
from typing import Any

from .. import google_ads_client as ads
from ..countries import of as country_of
from .base import KeywordProvider, intent_of


class AdsKeywords(KeywordProvider):
    source = "google_ads"

    def ideas(self, seed: str, location: str, business: Any | None = None) -> list[dict[str, Any]]:
        geo = ads.geo_target_for(country_of(business) if business is not None else None)
        rows = ads.keyword_ideas([seed], limit=60, geo_target=geo)
        out = []
        for r in rows:
            out.append({"keyword": r["keyword"], "volume": r["avg_monthly_searches"], "difficulty": r["competition_index"] if r["competition"] != "UNSPECIFIED" else None,
                        "cpc": r["high_top_of_page_bid"] or None, "intent": intent_of(r["keyword"])})
        return sorted(out, key=lambda x: -(x["volume"] or 0))
