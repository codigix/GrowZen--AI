# Google Trends Keyword Planner

Standalone keyword-research service built on the unofficial [`pytrends`](https://github.com/GeneralMills/pytrends)
client. This folder is self-contained — it does not import from, or modify,
`backend/` or `frontend/`.

## Run it

```bash
cd google_trends
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env          # optional, tweak defaults
uvicorn app.main:app --reload --port 8010
```

Open `http://localhost:8010/` for the built-in UI, or call the API directly.

## Endpoints

- `GET /api/keywords/trends?keyword=&country=&timeframe=` — interest-over-time + a calculated trend summary
- `GET /api/keywords/related?keyword=&country=&timeframe=` — top / rising / breakout related queries
- `GET /api/keywords/planner?keyword=&country=&timeframe=` — combines the above plus regional interest and a candidate-keyword list
- `GET /api/keywords/explore?keywords=&country=&state=&category=&timeframe=` — Google Trends "Explore"-style endpoint: compare up to 5 keywords side by side, narrowed to a country or a specific state/region, filtered by category, over one of Google's own lookback windows. Returns interest-over-time, top/rising/breakout related queries, and regional interest for every keyword in a single response.
- `GET /health` — liveness check

`country` is a 2-letter code (default `IN`). `timeframe` (for `/trends`, `/related`, `/planner`) is one of
`past_day`, `past_7_days`, `past_30_days`, `past_90_days`, `past_12_months`.

### `/api/keywords/explore` parameters

- `keywords` — comma-separated, 1-5 keywords, e.g. `keywords=seo audit,seo tool`
- `country` — 2-letter code (default `IN`)
- `state` — optional ISO 3166-2 region code without the country prefix, e.g. `KA` for Karnataka, `DL` for Delhi. Combined with `country` into Google's geo format (`IN-KA`). Google Trends has no free-text city targeting — country and first-level region are the most granular "location" it supports; when a state is given, the regional-interest breakdown switches to city-level results within that state.
- `category` — a dropdown of the real top-level Google Trends categories (e.g. `finance`, `arts_and_entertainment`), default `all_categories`. See `GET /api/keywords/categories` for the full list with ids and names.
- `timeframe` — one of `past_hour`, `past_four_hours`, `past_24_hours`, `past_week`, `past_month`, `past_3_months`, `past_year`, `past_5_years` (matches Google Trends' own Explore UI options)

The category list is pulled from `TrendReq().categories()` (Google's own taxonomy), not guessed, so the ids match what Google Trends itself uses.

## Data accuracy

Google Trends scores are **relative, normalized search-interest values on a
0–100 scale** — not absolute search volume. This service does not and will
not report, estimate, or fabricate:

- Exact monthly search volume
- Keyword difficulty
- Cost per click (CPC) or paid-ad competition
- Exact keyword ranking positions

Any field Google Trends doesn't return for a given keyword/region/timeframe
combination comes back as `null` (rendered as "Not available" in the UI)
rather than a guessed value.

## Reliability notes

`pytrends` scrapes Google Trends' internal, undocumented endpoints — it has
no SLA and can break or get rate-limited at any time. To reduce the blast
radius:

- All upstream calls are serialized (one at a time) and spaced out by
  `GOOGLE_TRENDS_MIN_REQUEST_INTERVAL_SECONDS` to avoid triggering 429s.
- Failed calls are retried up to `GOOGLE_TRENDS_MAX_RETRIES` times with
  backoff before surfacing a `503`.
- Successful responses are cached in-memory for `GOOGLE_TRENDS_CACHE_TTL_SECONDS`
  (per keyword/country/timeframe) to cut down on repeat requests.
- All Google Trends access goes through `app/services/trends_client.py`.
  If `pytrends` needs to be swapped for another provider later, that's the
  only module that has to change.

## Tests

```bash
pytest -q
```

Tests mock `pytrends` responses (via `app.services.trends_client`) — they
never hit the real Google Trends service.
