"""Paid data behind adapters: DataForSEO when its login is set, otherwise sample data.

Every result says which it is ("live" or "sample") so the UI can label it.
"""
from ...config import get_settings
from .base import BacklinkProvider, CitationProvider, KeywordProvider, RankProvider
from .sample import SampleBacklinks, SampleCitations, SampleKeywords, SampleRanks


def rank_provider() -> RankProvider:
    if get_settings().dataforseo_enabled:
        from .dataforseo import DataForSeoRanks
        return DataForSeoRanks()
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
    return SampleBacklinks()


def citation_provider() -> CitationProvider:
    # No licensed citation data source chosen yet: sample until one is.
    return SampleCitations()
