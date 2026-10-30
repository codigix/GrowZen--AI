"""Data behind adapters: DataForSEO when its login is set, else live Google results through Serper
(SERPER_API_KEY), else sample data.

Every result says which it is ("live" or "sample") so the UI can label it.
"""
from ...config import get_settings
from .base import BacklinkProvider, CitationProvider, KeywordProvider, RankProvider
from .sample import SampleBacklinks, SampleCitations, SampleKeywords, SampleRanks


def rank_provider() -> RankProvider:
    if get_settings().dataforseo_enabled:
        from .dataforseo import DataForSeoRanks
        return DataForSeoRanks()
    if get_settings().serper_api_key:
        from .serper import SerperRanks
        return SerperRanks()
    return SampleRanks()


def keyword_provider() -> KeywordProvider:
    if get_settings().dataforseo_enabled:
        from .dataforseo import DataForSeoKeywords
        return DataForSeoKeywords()
    return SampleKeywords()


def backlink_provider() -> BacklinkProvider:
    if get_settings().dataforseo_enabled:
        from .dataforseo import DataForSeoBacklinks
        return DataForSeoBacklinks()
    if get_settings().serper_api_key:
        from .serper import SerperBacklinks
        return SerperBacklinks()
    return SampleBacklinks()


def citation_provider() -> CitationProvider:
    # Listings found in Google results; sample only when no Google results source is set.
    if get_settings().serper_api_key:
        from .serper import SerperCitations
        return SerperCitations()
    return SampleCitations()
