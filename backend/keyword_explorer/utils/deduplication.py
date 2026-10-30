"""Deduplication and aggregation logic for collected keyword suggestions."""

from typing import Dict, List, NamedTuple, Set
from .normalization import normalize_keyword, sanitize_keyword


class RawSuggestion(NamedTuple):
    """Raw suggestion record from an individual platform call."""
    keyword: str
    source: str
    rank: int


class AggregatedSuggestion:
    """Grouped suggestion tracking occurrence across multiple sources."""

    def __init__(self, keyword: str, source: str, rank: int):
        self.keyword = sanitize_keyword(keyword)
        self.primary_source = source
        self.sources: Set[str] = {source}
        self.best_rank = rank

    def add_occurrence(self, source: str, rank: int) -> None:
        self.sources.add(source)
        if rank < self.best_rank:
            self.best_rank = rank
            self.primary_source = source


def deduplicate_suggestions(suggestions: List[RawSuggestion]) -> List[AggregatedSuggestion]:
    """
    Deduplicate raw suggestions case-insensitively, merging sources
    and preserving the lowest discovery rank.
    """
    merged: Dict[str, AggregatedSuggestion] = {}

    for item in suggestions:
        clean = sanitize_keyword(item.keyword)
        if not clean or len(clean) < 2:
            continue

        key = normalize_keyword(clean)
        existing = merged.get(key)
        if existing is None:
            merged[key] = AggregatedSuggestion(clean, item.source, item.rank)
        else:
            existing.add_occurrence(item.source, item.rank)

    # Sort primarily by lowest rank, secondarily by number of sources (multi-platform confirmation)
    result = list(merged.values())
    result.sort(key=lambda s: (s.best_rank, -len(s.sources)))
    return result

