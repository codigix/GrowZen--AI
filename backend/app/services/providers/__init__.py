"""Data behind adapters: Google Places for the Maps rank grid (GOOGLE_PLACES_API_KEY) and Google Ads for keyword volumes (GOOGLE_ADS_*). Organic positions come from Search Console (see services/google_rank.py).

Every result says which it is ("live"). Sample data exists only for tests and demos (ALLOW_SAMPLE_DATA=true); without it a missing key raises
DataUnavailable naming the key, so nothing invented is ever shown as if it were real.
"""
from ...config import get_settings
from ...errors import DataUnavailable
from .base import CitationProvider, KeywordProvider, RankProvider
from .sample import SampleKeywords, SampleRanks


def rank_provider() -> RankProvider:
    s = get_settings()
    if s.google_places_api_key or s.google_api_key:
        from .google import GooglePlacesRanks
        return GooglePlacesRanks()
    if s.allow_sample_data:
        return SampleRanks()
    raise DataUnavailable("Maps rank scans use the Google Places API. Set GOOGLE_PLACES_API_KEY on the server.")


def keyword_provider() -> KeywordProvider:
    s = get_settings()
    if s.google_ads_enabled:
        from .ads import AdsKeywords
        return AdsKeywords()
    if s.allow_sample_data:
        return SampleKeywords()
    raise DataUnavailable("Keyword volumes come from Google Ads Keyword Planner. Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN and GOOGLE_ADS_CUSTOMER_ID.")


def citation_provider() -> CitationProvider:
    from .google import ManualCitations
    return ManualCitations()
