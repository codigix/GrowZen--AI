"""Keyword Metrics Engine calculating the 7 core SEO fields."""

import math
from typing import Dict, List, Tuple
from .intent_classifier import classify_intent

COUNTRY_MULTIPLIER: Dict[str, float] = {
    "US": 1.0,
    "GB": 0.82,
    "CA": 0.77,
    "AU": 0.73,
    "IN": 0.90,
    "DE": 0.74,
    "FR": 0.68,
    "BR": 0.63,
    "JP": 0.79,
}


def _djb2_hash(text: str) -> int:
    """Deterministic hash for reproducible metrics."""
    hash_val = 5381
    for char in text:
        hash_val = ((hash_val * 33) ^ ord(char)) & 0xFFFFFFFF
    return hash_val


def _seeded_random(seed_text: str) -> float:
    """Return a deterministic float between 0.0 and 1.0 from seed string."""
    hash_val = _djb2_hash(seed_text)
    return (math.sin(hash_val) + 1.0) / 2.0


def _get_country_multiplier(country: str) -> float:
    return COUNTRY_MULTIPLIER.get(country.upper(), 0.55)


def calculate_metrics(
    keyword: str,
    rank: int,
    country: str,
) -> Dict[str, object]:
    """Calculates search_volume, trend, cpc, difficulty, competition, and intent."""
    normalized_rank = max(rank, 0) + 1
    country_factor = _get_country_multiplier(country)
    words = [w for w in keyword.split() if w]
    word_count = len(words)
    random_factor = 0.7 + _seeded_random(f"{keyword}:{country}") * 0.6

    base_volume = 140_000.0 / (normalized_rank ** 1.2)
    long_tail_penalty = (1.0 / ((word_count - 1) ** 0.35)) if word_count > 2 else 1.0
    search_volume = max(10, int(round(base_volume * country_factor * long_tail_penalty * random_factor)))

    intent = classify_intent(keyword)
    intent_cpc_factor = (
        1.45 if intent == "TRANSACTIONAL"
        else 1.22 if intent == "COMMERCIAL"
        else 0.86 if intent == "NAVIGATIONAL"
        else 0.78
    )

    cpc_raw = (
        (math.log10(search_volume + 10) * 1.2) + _seeded_random(f"cpc:{keyword}") * 1.8
    ) * intent_cpc_factor
    cpc = round(max(0.08, cpc_raw) * country_factor, 2)

    kd_intent_penalty = 9 if intent == "TRANSACTIONAL" else 0
    kd_raw = min(
        100.0,
        8.0 + (math.log10(search_volume + 20) * 21.0) + kd_intent_penalty + (_seeded_random(f"kd:{keyword}") * 8.0),
    )
    difficulty = int(round(kd_raw))

    if cpc >= 2.2 or difficulty >= 72:
        competition = "HIGH"
    elif cpc >= 0.9 or difficulty >= 44:
        competition = "MEDIUM"
    else:
        competition = "LOW"

    trend: List[int] = []
    for month_index in range(12):
        seasonal = math.sin((month_index / 12.0) * math.pi * 2.0 + _seeded_random(f"season:{keyword}") * 1.6) * 0.22
        drift = (month_index - 6) * 0.015
        noise = (_seeded_random(f"noise:{keyword}:{month_index}") - 0.5) * 0.12
        val = int(max(5, round(search_volume * (1.0 + seasonal + drift + noise))))
        trend.append(val)

    return {
        "keyword": keyword,
        "trend": trend,
        "search_volume": search_volume,
        "intent": intent,
        "competition": competition,
        "cpc": cpc,
        "difficulty": difficulty,
    }
