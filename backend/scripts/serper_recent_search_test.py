"""Standalone test for a "top 5 results from the last week" search feature, backed by Serper.dev.

Not wired into the FastAPI app yet -- this is just for trying it out before we decide where it
lives in the codebase (e.g. alongside keyword_explorer or as a new router).

Usage:
    python backend/scripts/serper_recent_search_test.py "social media bookmarking sites"
    python backend/scripts/serper_recent_search_test.py "social media bookmarking sites" --range week
    python backend/scripts/serper_recent_search_test.py "high-quality backlinks sites" --country us --range month

Needs SERPER_API_KEY set in backend/.env (or the environment) -- get one at https://serper.dev.
"""
import argparse
import os
import sys

import httpx
from dotenv import load_dotenv

SERPER_URL = "https://google.serper.dev/search"

# Google's "tbs" date-range codes (same ones the Playground's "Date range" dropdown sends).
# "any" sends no tbs at all -- plain Google results, same as "Any time" in the dropdown.
TBS_BY_RANGE = {
    "any": None,
    "day": "qdr:d",
    "week": "qdr:w",
    "month": "qdr:m",
    "year": "qdr:y",
}


def search_recent(query: str, country: str = "in", date_range: str = "any", top: int = 5) -> list[dict]:
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key:
        raise RuntimeError("SERPER_API_KEY is not set. Add it to backend/.env or export it first.")
    if date_range not in TBS_BY_RANGE:
        raise ValueError(f"Unknown date range {date_range!r}; choose one of {list(TBS_BY_RANGE)}")

    body = {"q": query, "gl": country, "num": top}
    tbs = TBS_BY_RANGE[date_range]
    if tbs:
        body["tbs"] = tbs
    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}

    resp = httpx.post(SERPER_URL, json=body, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for item in data.get("organic", [])[:top]:
        results.append({
            "position": item.get("position"),
            "title": item.get("title"),
            "link": item.get("link"),
            "snippet": item.get("snippet"),
            "date": item.get("date"),
        })
    return results


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Top N Google results from the last N days, via Serper.dev")
    parser.add_argument("query", help='Search query, e.g. "social media bookmarking sites"')
    parser.add_argument("--country", default="in", help="Google country code (gl), default: in")
    parser.add_argument("--range", dest="date_range", default="any", choices=list(TBS_BY_RANGE),
                        help="Date range, same as Google's dropdown: any, day, week, month, year. Default: any")
    parser.add_argument("--top", type=int, default=5, help="How many results to show, default: 5")
    args = parser.parse_args()

    try:
        results = search_recent(args.query, country=args.country, date_range=args.date_range, top=args.top)
    except (RuntimeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except httpx.HTTPStatusError as exc:
        print(f"Serper request failed: {exc.response.status_code} {exc.response.text}", file=sys.stderr)
        sys.exit(1)

    if not results:
        print(f'No results found for "{args.query}" (range={args.date_range}).')
        return

    print(f'Top {len(results)} organic results for "{args.query}" (range={args.date_range}, gl={args.country}):\n')
    for r in results:
        print(f"{r['position']}. {r['title']}")
        print(f"   {r['link']}")
        if r.get("date"):
            print(f"   date: {r['date']}")
        if r.get("snippet"):
            print(f"   {r['snippet']}")
        print()


if __name__ == "__main__":
    main()
