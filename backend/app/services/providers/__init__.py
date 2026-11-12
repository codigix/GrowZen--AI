"""Data behind adapters: live Google results through Serper (SERPER_API_KEY) and Google Ads (GOOGLE_ADS_*).

Every result says which it is ("live"). Sample data exists only for tests and demos (ALLOW_SAMPLE_DATA=true); without it a missing key raises
DataUnavailable naming the key, so nothing invented is ever shown as if it were real.
"""
from ...config import get_settings
from ...errors import DataUnavailable
from .base import BacklinkProvider, CitationProvider, KeywordProvider, RankProvider
from .sample import SampleBacklinks, SampleCitations, SampleKeywords, SampleRanks


def rank_provider() -> RankProvider:
    s = get_settings()
    if s.serper_api_key:
        from .serper import SerperRanks
        return SerperRanks()
    if s.allow_sample_data:
        return SampleRanks()
    raise DataUnavailable("Rank checks need live Google results. Set SERPER_API_KEY on the server (serper.dev).")


def keyword_provider() -> KeywordProvider:
    s = get_settings()
    if s.google_ads_enabled:
        from .ads import AdsKeywords
        return AdsKeywords()
    if s.allow_sample_data:
        return SampleKeywords()
    raise DataUnavailable("Keyword volumes come from Google Ads Keyword Planner. Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN and GOOGLE_ADS_CUSTOMER_ID.")


def backlink_provider() -> BacklinkProvider:
    s = get_settings()
    if s.serper_api_key:
        from .serper import SerperBacklinks
        return SerperBacklinks()
    if s.allow_sample_data:
        return SampleBacklinks()
    raise DataUnavailable("The backlink check needs live Google results. Set SERPER_API_KEY on the server (serper.dev).")


def citation_provider() -> CitationProvider:
    # Listings found in Google results.
    s = get_settings()
    if s.serper_api_key:
        from .serper import SerperCitations
        return SerperCitations()
    if s.allow_sample_data:
        return SampleCitations()
    raise DataUnavailable("The listings check needs live Google results. Set SERPER_API_KEY on the server (serper.dev).")
