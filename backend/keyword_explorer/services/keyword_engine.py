"""Core Keyword Discovery and Aggregation Engine."""

import asyncio
import time
from typing import Dict, List, Optional, Set, Tuple
import httpx

from ..config import settings
from ..schemas.keyword import (
    KeywordItem,
    KeywordSearchRequest,
)
from .metrics_engine import calculate_metrics
from .platforms import PLATFORM_REGISTRY, BasePlatformFetcher
from ..utils.deduplication import RawSuggestion, deduplicate_suggestions
from ..utils.normalization import normalize_keyword, sanitize_keyword

QUERY_MODIFIERS = [
    "best",
    "top",
    "services",
    "pricing",
    "cost",
    "reviews",
    "agency",
    "near me",
    "in india",
    "in usa",
    "for startups",
    "for enterprise",
    "alternatives",
    "vs",
    "consulting",
    "solutions",
    "online",
    "software",
    "course",
    "training",
    "salary",
    "jobs",
    "portfolio",
    "contract",
    "rates",
    "guide",
    "examples",
    "strategy",
]

PREPOSITIONS = ["in", "for", "with", "vs", "near", "from", "at", "by"]
ALPHABET = list("abcdefghijklmnopqrstuvwxyz")


class KeywordEngine:
    """Asynchronous keyword discovery engine with concurrency controls and caching."""

    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[float, List[KeywordItem]]] = {}

    def _get_cache_key(self, request: KeywordSearchRequest) -> str:
        platforms_sorted = ",".join(sorted(p.lower() for p in request.platforms))
        return (
            f"{normalize_keyword(request.keyword)}|"
            f"{request.country.upper()}|"
            f"{request.language.lower()}|"
            f"{platforms_sorted}|"
            f"{request.limit}|"
            f"{request.include_expansions}"
        )

    def _read_cache(self, key: str) -> Optional[List[KeywordItem]]:
        entry = self._cache.get(key)
        if not entry:
            return None
        expires_at, response = entry
        if time.time() > expires_at:
            del self._cache[key]
            return None
        return response

    def _write_cache(self, key: str, response: List[KeywordItem]) -> None:
        ttl = settings.KEYWORD_CACHE_TTL_SECONDS
        self._cache[key] = (time.time() + ttl, response)

    def build_expansion_queries(self, seed: str, limit: int = 50) -> List[str]:
        """Generate diverse search queries using seed, modifiers, prepositions, and alphabet expansion."""
        clean_seed = sanitize_keyword(seed)
        seen: Set[str] = set()
        queries: List[str] = [clean_seed]
        seen.add(normalize_keyword(clean_seed))

        # 1. Modifiers
        for mod in QUERY_MODIFIERS:
            expanded = f"{clean_seed} {mod}"
            norm = normalize_keyword(expanded)
            if norm not in seen:
                seen.add(norm)
                queries.append(expanded)
                if len(queries) >= limit:
                    return queries

        # 2. Suffix Alphabet characters (a-z)
        for letter in ALPHABET:
            expanded = f"{clean_seed} {letter}"
            norm = normalize_keyword(expanded)
            if norm not in seen:
                seen.add(norm)
                queries.append(expanded)
                if len(queries) >= limit:
                    return queries

        # 3. Prepositions
        for prep in PREPOSITIONS:
            expanded = f"{clean_seed} {prep}"
            norm = normalize_keyword(expanded)
            if norm not in seen:
                seen.add(norm)
                queries.append(expanded)
                if len(queries) >= limit:
                    return queries

        # 4. Prefix Alphabet characters (a-z)
        for letter in ALPHABET:
            expanded = f"{letter} {clean_seed}"
            norm = normalize_keyword(expanded)
            if norm not in seen:
                seen.add(norm)
                queries.append(expanded)
                if len(queries) >= limit:
                    return queries

        return queries

    async def execute_search(self, request: KeywordSearchRequest) -> List[KeywordItem]:
        """Execute full keyword research workflow returning up to request.limit keywords."""
        cache_key = self._get_cache_key(request)
        cached_result = self._read_cache(cache_key)
        if cached_result:
            return cached_result[: request.limit]

        # Identify requested platforms
        fetchers: List[Tuple[str, BasePlatformFetcher]] = []
        for p in request.platforms:
            pid = p.lower().strip()
            fetcher = PLATFORM_REGISTRY.get(pid)
            if fetcher:
                fetchers.append((pid, fetcher))

        # Fallback to Google if no recognized platforms
        if not fetchers:
            fetchers = [("google", PLATFORM_REGISTRY["google"])]

        # Dynamically scale expansion query limit based on requested limit
        if request.include_expansions:
            target_queries = min(50, max(12, min(settings.KEYWORD_QUERY_LIMIT, max(14, int(request.limit * 0.25)))))
            queries = self.build_expansion_queries(
                request.keyword,
                limit=target_queries,
            )
        else:
            queries = [sanitize_keyword(request.keyword)]

        # Parallel multi-platform concurrency controls
        platform_concurrency = getattr(settings, "KEYWORD_PLATFORM_CONCURRENCY", 4)
        global_concurrency = max(settings.KEYWORD_FETCH_CONCURRENCY, len(fetchers) * platform_concurrency)
        global_semaphore = asyncio.Semaphore(global_concurrency)
        platform_semaphores = {
            pid: asyncio.Semaphore(platform_concurrency)
            for pid, _ in fetchers
        }

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
        }

        limits = httpx.Limits(
            max_keepalive_connections=30,
            max_connections=100,
            keepalive_expiry=30.0,
        )

        async with httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(settings.KEYWORD_API_TIMEOUT_SECONDS),
            limits=limits,
            follow_redirects=True,
        ) as client:

            async def _fetch_query(
                platform_id: str,
                platform_fetcher: BasePlatformFetcher,
                query_str: str,
            ) -> List[RawSuggestion]:
                async with platform_semaphores[platform_id]:
                    async with global_semaphore:
                        try:
                            results = await platform_fetcher.fetch_suggestions(
                                client,
                                query_str,
                                request.language,
                                request.country,
                            )
                            return [
                                RawSuggestion(
                                    keyword=kw,
                                    source=platform_id,
                                    rank=idx,
                                )
                                for idx, kw in enumerate(results)
                            ]
                        except Exception:
                            return []

            async def _platform_worker(
                platform_id: str,
                platform_fetcher: BasePlatformFetcher,
            ) -> List[RawSuggestion]:
                # Concurrently execute queries for this platform
                query_tasks = [
                    _fetch_query(platform_id, platform_fetcher, query)
                    for query in queries
                ]
                query_batches = await asyncio.gather(*query_tasks, return_exceptions=False)
                flattened: List[RawSuggestion] = []
                for batch in query_batches:
                    flattened.extend(batch)
                return flattened

            # Run all 4 to 5 platforms in parallel simultaneously
            platform_workers = [
                _platform_worker(pid, fetcher)
                for pid, fetcher in fetchers
            ]
            platform_results = await asyncio.gather(*platform_workers, return_exceptions=False)

            raw_suggestions: List[RawSuggestion] = []
            for suggestions in platform_results:
                raw_suggestions.extend(suggestions)

        # Deduplicate suggestions across all platforms
        deduped = deduplicate_suggestions(raw_suggestions)

        # Build final KeywordItem list containing ONLY the requested 7 fields
        keywords_output: List[KeywordItem] = []
        for item in deduped[: request.limit]:
            metrics = calculate_metrics(
                keyword=item.keyword,
                rank=item.best_rank,
                country=request.country,
            )
            keyword_item = KeywordItem(
                keyword=item.keyword,
                trend=metrics["trend"],  # type: ignore
                search_volume=metrics["search_volume"],  # type: ignore
                intent=metrics["intent"],  # type: ignore
                competition=metrics["competition"],  # type: ignore
                cpc=metrics["cpc"],  # type: ignore
                difficulty=metrics["difficulty"],  # type: ignore
            )
            keywords_output.append(keyword_item)

        self._write_cache(cache_key, keywords_output)
        return keywords_output


keyword_engine = KeywordEngine()
