"""Engine A: Google PageSpeed Insights API (hosted Lighthouse)."""
from __future__ import annotations

import httpx

from app.audit_engines.errors import (
    EngineExecutionError,
    EngineQuotaError,
    EngineTimeoutError,
)

PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
CATEGORIES = ["performance", "accessibility", "best-practices", "seo"]


async def run_pagespeed_audit(
    *,
    url: str,
    strategy: str,
    api_key: str,
    timeout_seconds: int,
) -> dict:
    """Call the PageSpeed Insights API and return the raw JSON response,
    which embeds a full ``lighthouseResult`` (same shape as the Lighthouse
    CLI JSON report) plus CrUX ``loadingExperience`` field data.
    """
    params = [
        ("url", url),
        ("strategy", strategy),
        ("key", api_key),
    ]
    for category in CATEGORIES:
        params.append(("category", category))

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.get(PSI_ENDPOINT, params=params)
    except httpx.TimeoutException as exc:
        raise EngineTimeoutError(
            f"PageSpeed Insights request timed out after {timeout_seconds}s"
        ) from exc
    except httpx.HTTPError as exc:
        raise EngineExecutionError(f"PageSpeed Insights request failed: {exc}") from exc

    if response.status_code == 429:
        raise EngineQuotaError("PageSpeed Insights API quota/rate limit exceeded")

    if response.status_code != 200:
        try:
            payload = response.json()
            message = payload.get("error", {}).get("message", response.text)
            status = payload.get("error", {}).get("status", "")
        except ValueError:
            message = response.text
            status = ""
        if response.status_code == 403 and "quota" in message.lower():
            raise EngineQuotaError(f"PageSpeed Insights quota exceeded: {message}")
        if status == "RESOURCE_EXHAUSTED" or "quota" in message.lower():
            raise EngineQuotaError(f"PageSpeed Insights quota exceeded: {message}")
        raise EngineExecutionError(
            f"PageSpeed Insights API error ({response.status_code}): {message}"
        )

    data = response.json()
    if "lighthouseResult" not in data:
        raise EngineExecutionError(
            "PageSpeed Insights response did not include a Lighthouse result "
            "(the page may be unreachable or blocked the crawler)"
        )
    return data
