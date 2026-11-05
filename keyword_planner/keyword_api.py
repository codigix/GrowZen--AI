import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

load_dotenv()

config = {
    "developer_token": os.getenv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "client_id": os.getenv("GOOGLE_ADS_CLIENT_ID"),
    "client_secret": os.getenv("GOOGLE_ADS_CLIENT_SECRET"),
    "refresh_token": os.getenv("GOOGLE_ADS_REFRESH_TOKEN"),
    "use_proto_plus": True,
}

customer_id = os.getenv("GOOGLE_ADS_CUSTOMER_ID")

app = FastAPI(title="Keyword Metrics API")


def _micros_to_currency(micros):
    return round(micros / 1_000_000, 2) if micros else 0.0


def _pct_change(old, new):
    if not old:
        return None
    return round(((new - old) / old) * 100, 2)


def _build_metrics(idea, include_monthly=True):
    metrics = idea.keyword_idea_metrics

    monthly_volumes = []
    for mv in metrics.monthly_search_volumes:
        monthly_volumes.append({
            "year": mv.year,
            "month": mv.month.name,
            "monthly_searches": mv.monthly_searches,
        })

    three_month_change = None
    yoy_change = None
    if len(monthly_volumes) >= 4:
        latest = monthly_volumes[-1]["monthly_searches"]
        three_months_ago = monthly_volumes[-4]["monthly_searches"]
        three_month_change = _pct_change(three_months_ago, latest)
    if len(monthly_volumes) >= 13:
        latest = monthly_volumes[-1]["monthly_searches"]
        twelve_months_ago = monthly_volumes[-13]["monthly_searches"]
        yoy_change = _pct_change(twelve_months_ago, latest)

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


def get_keyword_ideas(seed_keywords, limit=None, include_monthly=True):
    client = GoogleAdsClient.load_from_dict(config)
    service = client.get_service("KeywordPlanIdeaService")

    request = client.get_type("GenerateKeywordIdeasRequest")
    request.customer_id = customer_id
    request.language = "languageConstants/1000"  # English
    request.geo_target_constants.append("geoTargetConstants/2356")  # India
    request.keyword_plan_network = (
        client.enums.KeywordPlanNetworkEnum.GOOGLE_SEARCH_AND_PARTNERS
    )
    request.historical_metrics_options.include_average_cpc = True
    request.keyword_seed.keywords.extend(seed_keywords)

    response = service.generate_keyword_ideas(request=request)

    results = []
    for idea in response:
        results.append(_build_metrics(idea, include_monthly=include_monthly))
        if limit and len(results) >= limit:
            break
    return results


@app.get("/keyword-metrics")
def keyword_metrics(
    keyword: str = Query(..., description="Keyword to look up"),
    limit: int = Query(50, ge=1, le=1000, description="Max number of keyword ideas to return"),
    include_monthly: bool = Query(
        False, description="Include per-month search volume history (large payload)"
    ),
):

    try:
        ideas = get_keyword_ideas([keyword], limit=limit, include_monthly=include_monthly)
    except GoogleAdsException as ex:
        raise HTTPException(
            status_code=502,
            detail={
                "error": ex.error.code().name,
                "messages": [error.message for error in ex.failure.errors],
            },
        )

    if not ideas:
        raise HTTPException(status_code=404, detail="No data found for this keyword")

    return {
        "seed_keyword": keyword,
        "returned": len(ideas),
        "limit": limit,
        "keywords": ideas,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
