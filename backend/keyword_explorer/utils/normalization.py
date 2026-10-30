"""String normalization and sanitization utilities for keyword processing."""

import re


def sanitize_keyword(value: str) -> str:
    """Strip control characters, collapse whitespace, and trim."""
    if not value:
        return ""
    # Remove control characters \x00-\x1f
    cleaned = re.sub(r"[\x00-\x1F\x7F]", "", value)
    # Collapse multiple whitespace characters into single space
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def normalize_keyword(value: str) -> str:
    """Sanitize and convert keyword to lowercase for canonical matching."""
    return sanitize_keyword(value).lower()

