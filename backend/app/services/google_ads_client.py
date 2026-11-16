"""Google Ads Keyword Planner: search volume, competition, CPC bid ranges for a keyword."""
import logging

from ..config import get_settings

log = logging.getLogger("seo.google_ads")

# India / English by default (matches this platform's primary market); callers can override.
DEFAULT_LANGUAGE = "languageConstants/1000"  # English
DEFAULT_GEO_TARGET = "geoTargetConstants/2356"  # India


class GoogleAdsError(RuntimeError):
    pass


class GoogleAdsNotConfigured(GoogleAdsError):
    pass


class GoogleAdsRequestError(GoogleAdsError):
    def __init__(self, message: str, *, code: str | None = None, details: list[str] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or []


class _NeverRaised(Exception):
    pass


def _ads_exception():
    """The library's error class; when the package is not installed, a class nothing raises, so _client() can report the real reason (not a raw ImportError / HTTP 500)."""
    try:
        from google.ads.googleads.errors import GoogleAdsException
        return GoogleAdsException
    except ImportError:
        return _NeverRaised


def _client():
    settings = get_settings()
    if not settings.google_ads_enabled:
        raise GoogleAdsNotConfigured("Google Ads is not configured (missing developer token, OAuth credentials, or customer id).")

    try:
        from google.ads.googleads.client import GoogleAdsClient
    except ImportError as exc:
        raise GoogleAdsNotConfigured("The google-ads package is not installed on the server (pip install -r requirements.txt).") from exc

    config = {
        "developer_token": settings.google_ads_developer_token,
        "client_id": settings.google_ads_client_id,
        "client_secret": settings.google_ads_client_secret,
        "refresh_token": settings.google_ads_refresh_token,
        "use_proto_plus": True,
    }
    if settings.google_ads_login_customer_id:
        config["login_customer_id"] = settings.google_ads_login_customer_id
    try:
        return GoogleAdsClient.load_from_dict(config), settings.google_ads_customer_id
    except Exception as exc:  # malformed credentials in .env
        raise GoogleAdsNotConfigured(f"Google Ads credentials are invalid: {exc}") from exc


def _micros_to_currency(micros: int) -> float:
    return round(micros / 1_000_000, 2) if micros else 0.0


def _pct_change(old: int, new: int) -> float | None:
    if not old:
        return None
    return round(((new - old) / old) * 100, 2)


def _build_metrics(idea, include_monthly: bool) -> dict:
    metrics = idea.keyword_idea_metrics

    monthly_volumes = [
        {"year": mv.year, "month": mv.month.name, "monthly_searches": mv.monthly_searches}
        for mv in metrics.monthly_search_volumes
    ]

    three_month_change = None
    yoy_change = None
    if len(monthly_volumes) >= 4:
        three_month_change = _pct_change(monthly_volumes[-4]["monthly_searches"], monthly_volumes[-1]["monthly_searches"])
    if len(monthly_volumes) >= 13:
        yoy_change = _pct_change(monthly_volumes[-13]["monthly_searches"], monthly_volumes[-1]["monthly_searches"])

    result = {
        "keyword": idea.text,
        "avg_monthly_searches": metrics.avg_monthly_searches,
        "competition": metrics.competition.name,
        "competition_index": metrics.competition_index,
        "low_top_of_page_bid": _micros_to_currency(metrics.low_top_of_page_bid_micros),
        "high_top_of_page_bid": _micros_to_currency(metrics.high_top_of_page_bid_micros),
        "three_month_change": three_month_change,
        "yoy_change": yoy_change,
    }
    if include_monthly:
        result["monthly_search_volumes"] = monthly_volumes
    return result


def keyword_ideas(
    seed_keywords: list[str],
    *,
    limit: int = 50,
    include_monthly: bool = False,
    language: str = DEFAULT_LANGUAGE,
    geo_target: str = DEFAULT_GEO_TARGET,
) -> list[dict]:
    """Keyword ideas + metrics for one or more seed keywords, via the Keyword Planner (GenerateKeywordIdeas)."""
    GoogleAdsException = _ads_exception()

    client, customer_id = _client()
    service = client.get_service("KeywordPlanIdeaService")

    request = client.get_type("GenerateKeywordIdeasRequest")
    request.customer_id = customer_id
    request.language = language
    request.geo_target_constants.append(geo_target)
    request.keyword_plan_network = client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH_AND_PARTNERS
    request.historical_metrics_options.include_average_cpc = True
    request.keyword_seed.keywords.extend(seed_keywords)

    results = []
    try:
        response = service.generate_keyword_ideas(request=request)
        for idea in response:
            results.append(_build_metrics(idea, include_monthly))
            if limit and len(results) >= limit:
                break
    except GoogleAdsException as exc:
        messages = [error.message for error in exc.failure.errors]
        log.warning("Google Ads request failed: %s", messages)
        raise GoogleAdsRequestError("Google Ads request failed", code=exc.error.code().name, details=messages) from exc
    except Exception as exc:  # auth refresh failures, network errors, etc.
        log.warning("Google Ads call failed: %r", exc)
        raise GoogleAdsRequestError("Google Ads request failed", code=type(exc).__name__, details=[str(exc) or type(exc).__name__]) from exc
    return results


# Country code -> Google Ads geo target constant (the markets this platform serves; others fall back to the default).
GEO_TARGETS = {"IN": 2356, "US": 2840, "GB": 2826, "UK": 2826, "AU": 2036, "CA": 2124, "AE": 2784, "SG": 2702, "DE": 2276, "FR": 2250,
               "NZ": 2554, "ZA": 2710, "SA": 2682, "NG": 2566, "KE": 2404, "PK": 2586, "BD": 2050, "LK": 2144, "MY": 2458, "PH": 2608}


def geo_target_for(country: str | None) -> str:
    code = GEO_TARGETS.get((country or "").upper())
    return f"geoTargetConstants/{code}" if code else DEFAULT_GEO_TARGET


def historical_metrics(keywords: list[str], *, geo_target: str = DEFAULT_GEO_TARGET, language: str = DEFAULT_LANGUAGE) -> dict[str, dict]:
    """Exact monthly search volume, competition and top-of-page bid for each given keyword (not related ideas)."""
    GoogleAdsException = _ads_exception()

    client, customer_id = _client()
    service = client.get_service("KeywordPlanIdeaService")
    request = client.get_type("GenerateKeywordHistoricalMetricsRequest")
    request.customer_id = customer_id
    request.language = language
    request.geo_target_constants.append(geo_target)
    request.keyword_plan_network = client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH
    request.keywords.extend(keywords)
    out: dict[str, dict] = {}
    try:
        response = service.generate_keyword_historical_metrics(request=request)
        for res in response.results:
            m = res.keyword_metrics
            out[res.text.lower()] = {
                "volume": int(m.avg_monthly_searches or 0),
                "competition": m.competition.name,
                "competition_index": int(m.competition_index or 0),
                "cpc": round(_micros_to_currency(m.high_top_of_page_bid_micros) or 0, 2) or None,
            }
    except GoogleAdsException as exc:
        messages = [error.message for error in exc.failure.errors]
        log.warning("Google Ads metrics failed: %s", messages)
        raise GoogleAdsRequestError("Google Ads request failed", code=exc.error.code().name, details=messages) from exc
    except Exception as exc:
        log.warning("Google Ads metrics call failed: %r", exc)
        raise GoogleAdsRequestError("Google Ads request failed", code=type(exc).__name__, details=[str(exc) or type(exc).__name__]) from exc
    return out
