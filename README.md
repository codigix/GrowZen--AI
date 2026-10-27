# Codigix SEO Platform

A standalone app for running local SEO for clients. You paste or forward an onboarding email, or
connect the owner's Google account. The platform then finds the business, audits it, plans the work
and keeps it running on a schedule. It is completely separate from the CRM: it has its own code,
database, users and processes.

```
GrowZen--AI/
  backend/                 Python FastAPI API + SQLite (dev) / PostgreSQL (prod) + scheduler   → port 8000
    google_trends/         Standalone keyword-trend research microservice (pytrends)           → port 8100
  frontend/                React (Vite + Tailwind) web app with every SEO page                 → port 3100
  .env                     One shared .env for all three services (copy from .env.example)
```

One `.env` at the repo root configures all three services — there is no per-folder `.env` anymore.
See `.env.example` for the full list of settings.

## Run it locally (three terminals)

**Backend: terminal 1**

```bash
cd backend
pip install -r requirements.lock      # or: python -m venv .venv && activate it first, if you want isolation
alembic upgrade head                  # creates / updates the database tables
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

**Frontend: terminal 2**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3100 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (from the root `.env`).
That admin account is created automatically the first time the backend starts, as long as the
database has no users yet. Add more people under **Users** in the sidebar. The roles are admin,
editor and viewer.

**google_trends (keyword research): terminal 3 — optional, only needed for the Keyword Trends feature**

```bash
cd backend/google_trends
pip install -r requirements.txt       # or: python -m venv .venv && activate it first, if you want isolation
uvicorn app.main:app --reload --port 8100
```

The backend proxies to it under `/api/v1/keyword-trends/*`; if it isn't running, those specific
endpoints return a 503 but the rest of the platform works normally. See
[`google_trends` below](#google_trends-keyword-research-microservice) for details.

## Database

- **Local dev:** `DATABASE_URL=sqlite:///./seo_platform_dev.db` stores everything in a single file in
  `backend/` (path is relative to where the backend process runs from).
- **Real use:** PostgreSQL. Create the database once (`CREATE DATABASE seo_platform_db;`), then set
  `DATABASE_URL=postgresql+psycopg://user:password@host:5432/seo_platform_db`.
- After pulling new code, run `alembic upgrade head` again (from `backend/`).

## Settings

All settings go in the root `.env`; see `.env.example` for the full list. Without a key, the
matching feature uses sample data (shown with a "sample data" label) or stays off. The
**Connections & Plans** page shows what is currently connected.

| Setting | Turns on |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Connect Google account": imports the Business Profiles that account manages. Register `http://localhost:8000/api/v1/connections/google/callback` as a redirect URI and enable the Business Profile APIs |
| `GOOGLE_PLACES_API_KEY` | "Find by email": finds a business on Google Maps from an email address and its website |
| `PAGESPEED_API_KEY` | Technical SEO audit; Lighthouse audits (PageSpeed engine) |
| Node.js + `npm install -g lighthouse` + Chrome/Edge (no setting) | Lighthouse audits (local engine, original Lighthouse HTML). Options: `LIGHTHOUSE_*` in `.env.example` |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | Live rank grid, keyword volumes, backlinks |
| `AI_PROVIDER` + `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | AI drafts (posts, review replies, descriptions), email reading, reports |
| `INTAKE_IMAP_*`, `SMTP_*` | Reading the onboarding mailbox; sending reports and replies |
| `GOOGLE_TRENDS_BASE_URL` | Where the backend looks for the `google_trends` microservice (default `http://localhost:8100`) |

The frontend has one setting, `VITE_API_URL` (also in the root `.env`). Its default is
`http://localhost:8000/api/v1`.

## Production

1. `cd frontend && npm run build`. This writes `frontend/dist`.
2. Run the backend. When `frontend/dist` exists, the backend serves the web app at the same address
   as the API, so only one process and one port are needed. Set `FRONTEND_URL` and
   `PUBLIC_BASE_URL` to that public address and `COOKIE_SECURE=true` (HTTPS). Use a long random
   `SECRET_KEY`.
3. Run a single backend instance with `SCHEDULER_ENABLED=true`. If you run extra instances, set it
   to `false` on them.
4. Run `google_trends` as its own process if the Keyword Trends feature is needed in production;
   point `GOOGLE_TRENDS_BASE_URL` at wherever it's reachable.

## Tests

```bash
cd backend
pytest -q
```

```bash
cd backend/google_trends
pytest -q
```

---

# Backend

The API for the SEO platform (the GREXA-style blueprint). It has its own code, its own database, its
own users and its own process; it shares nothing with the CRM. The web app that uses it is in
`frontend/`.

**Stack:** Python 3.12+ · FastAPI · SQLAlchemy 2 · PostgreSQL/SQLite · Alembic · APScheduler · httpx ·
BeautifulSoup · OpenAI-compatible AI.

## What it does

An onboarding email reaches a dedicated mailbox. From there the service runs every step with no
manual work:

1. **Intake** reads the mailbox (IMAP) or accepts a webhook POST. Only emails from the team's
   addresses are accepted.
2. **Extraction** pulls the business out of the email. A rule-based reader runs first, so it works
   without AI. The AI's answer is kept only where it matches the email text. If the name or phone is
   missing, it emails the sender back to ask.
3. **Profile**: the business is created, or matched to an existing one by phone, website or name.
4. **GBP match** links the business to a location under a connected Google account, then pulls in its
   reviews, photo count and daily calls, directions and clicks.
5. **Audits** (each saves a score, issues, and whether the data was `live` or `sample`):

   | Area | How it's checked |
   |---|---|
   | `gbp` | 0–100 profile score on relevance, distance and prominence; same rules as the frontend |
   | `rankings` | Map-grid scans |
   | `technical` | PageSpeed Insights |
   | `onpage` | The service's own crawler: robots.txt, sitemap, titles, meta descriptions, H1, depth, noindex, alt text, schema, broken links |
   | `backlinks` | Backlink data provider |
   | `citations` | Directory listings checked for matching name, address and phone |

6. **Plan**: the planner turns issues into agent tasks, ranked by impact.
7. **Report**: a plain-words summary plus a PDF.
8. **Schedule**: per-business jobs set from the client's plan.
9. **Notify**: the report is emailed to the sender.

After onboarding, the scheduler runs each business's jobs on time:

| Job | What it does |
|---|---|
| `full_audit` | All audits, then plans new tasks |
| `rank_scan` | Map-grid scan |
| `technical` | PageSpeed check |
| `reviews` | Syncs reviews, then AI drafts replies |
| `posts` | AI drafts a GBP post |
| `report` | Emails the monthly report |
| `geo` | AI-visibility check |

**Lighthouse audits** (no business needed) run a full Google Lighthouse report on any URL, or on
every page in a site's `sitemap.xml` (up to 100). They return scores, Core Web Vitals, CrUX field
data, opportunities, diagnostics, and failed and passed audits, plus the raw JSON and HTML reports
for download. There are two engines:

- **PageSpeed Insights** (`PAGESPEED_API_KEY`): Lighthouse runs on Google's servers.
- **Local Lighthouse CLI**: Node.js, `npm install -g lighthouse`, and Chrome or Edge on this server.
  It writes the original Lighthouse HTML.

If PageSpeed fails, the audit falls back to the local engine and records why. Scores always come from
a real Lighthouse run. If neither engine works, the audit fails with the reason.

Every URL is checked for SSRF before it is queued and again before it runs. It must be http(s) with
no credentials, and every DNS answer must be public. Chrome is pinned to the IP that was checked.
Each engine has its own worker limit. Unfinished audits are marked failed when the server restarts.
Report files are kept in `LIGHTHOUSE_REPORTS_DIR`.

**Keyword Trends**: `/api/v1/keyword-trends/*` proxies to the standalone `google_trends` microservice
(see below) so the frontend only ever talks to this one backend. If `google_trends` isn't running,
these specific endpoints return a 503; everything else keeps working.

**Approvals:** anything that reaches Google or the website is an **agent task**. A task is applied
only after approval, unless the playbook allows autopilot for that kind. Profile edits always ask.
Every action goes to the activity log.

## Data sources

| Feature | Live with | Without it |
|---|---|---|
| GBP profiles, reviews, insights, replies, posts | Google OAuth client (Business Profile API approved) | Businesses entered by email or by hand |
| Technical SEO | `PAGESPEED_API_KEY` | Audit fails with a clear message |
| Lighthouse audits | `PAGESPEED_API_KEY` and/or local Node.js + `lighthouse` + Chrome | Audit fails with a clear message |
| On-page SEO | Built-in crawler | Always live |
| Rank grid, keyword volume, backlinks | DataForSEO login | Sample data, labelled `sample` |
| Citations | No licensed source chosen yet | Sample data |
| GEO / AEO | OpenAI, Gemini, Perplexity, Anthropic, DeepSeek keys | Sample data |
| AI drafts, extraction, reports | `AI_PROVIDER` key | Rule-based extraction; template report; no drafts |
| Keyword Trends (Google Trends data) | `google_trends` microservice running (no key needed) | 503 on those endpoints only |

## Run it

```bash
cd backend
pip install -r requirements.lock      # exact tested versions (requirements.txt = ranges)
# create the database once (PostgreSQL):  CREATE DATABASE seo_platform_db;
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Interactive API docs are at http://localhost:8000/docs.

**Production:** run one instance with the scheduler (`SCHEDULER_ENABLED=true`). If you run more API
instances, set `SCHEDULER_ENABLED=false` on the others.

## Tests

```bash
pytest -q
```

The tests use a throwaway SQLite database, with no network and no AI. They cover:
- the profile score;
- email extraction (labelled, loose and missing-phone emails);
- crawler page checks and AI-answer analysis;
- login (own accounts, password hashing, admin-only user management) and refusal of bad tokens;
- the full onboarding pipeline end to end (steps, audits, the Growth plan's schedules, approvals,
  report PDF, duplicate handling);
- needs-info emails, sender filtering, the webhook token, rank scans, keywords, and the playbook;
- Lighthouse audits: SSRF checks, both engines and the fallback, report normalisation, sitemap
  discovery, duplicates, re-runs, downloads, rate limits, site audits and restart recovery (DNS and
  HTTP are faked).

One test really runs Node, Lighthouse and Chrome against example.com. It is skipped unless
`RUN_LIVE_TESTS=1` is set.

## API (prefix `/api/v1`)

| Area | Endpoints |
|---|---|
| System | `GET /health`, `GET /me`, `GET /status` |
| Login | `POST /auth/login`, `POST /auth/logout`, `GET/POST /users`, `PATCH /users/{id}` (admins) |
| Businesses | `GET/POST /businesses`, `GET/PATCH/DELETE /businesses/{id}`, `GET /businesses/{id}/overview`, `GET /businesses/{id}/gbp/score`, `POST /businesses/{id}/sync` |
| Audits | `POST /businesses/{id}/audits` (background), `GET /businesses/{id}/audits`, `GET /businesses/{id}/audits/{audit_id}` |
| Website check | `POST /website-audits` → `{id}`, `GET /website-audits/{id}`, `GET /website-audits` (history) |
| Lighthouse | `POST /lighthouse/audits` `{url, strategy: mobile\|desktop, engine: pagespeed\|lighthouse}` → `{id, status, status_url}`, `GET /lighthouse/audits/{id}`, `GET .../{id}/report`, `GET .../{id}/download/json`, `GET .../{id}/download/html`, `POST .../{id}/rerun`, `GET /lighthouse/audits/history?page=&page_size=`, `POST /lighthouse/site-audits` `{url, strategy, engine, max_pages}`, `GET /lighthouse/site-audits/{id}`, `GET /lighthouse/site-audits/history`, `GET /lighthouse/health` |
| Keyword Trends | `GET /keyword-trends/trends`, `GET /keyword-trends/related`, `GET /keyword-trends/planner`, `GET /keyword-trends/explore`, `GET /keyword-trends/categories`, `GET /keyword-trends/health` — proxied to `google_trends` |
| Intake | `GET /intake/emails`, `GET /intake/emails/{id}`, `POST /intake/emails` (paste), `POST /intake/webhook` (header `X-Intake-Token`), `POST /intake/emails/{id}/process`, `POST /intake/poll` |
| Google | `GET /connections`, `GET /connections/google/start` → sign-in URL, `GET /connections/google/callback`, `GET /connections/{id}/locations`, `POST /connections/{id}/import`, `POST /connections/{id}/sync`, `DELETE /connections/{id}` |
| Profile | `GET/POST /businesses/{id}/posts`, `POST /businesses/{id}/posts/draft`, `GET /businesses/{id}/reviews`, `POST /businesses/{id}/reviews/{rid}/draft`, `POST /businesses/{id}/reviews/{rid}/approve` |
| Growth | `GET/POST /businesses/{id}/keywords`, `POST .../keywords/ideas`, `POST .../keywords/cluster`, `POST/GET .../rank-scans`, `GET .../geo`, `POST .../geo/prompts`, `POST .../geo/run`, `GET .../backlinks`, `GET .../citations` |
| Leads | `GET/POST /businesses/{id}/leads`, `PATCH .../leads/{lid}?status=`, `GET .../insights?days=` |
| Reports | `GET /businesses/{id}/report?month=YYYY-MM`, `GET /businesses/{id}/report.pdf` |
| Schedules | `GET/PUT /businesses/{id}/schedules` |
| Agent | `GET /tasks?status=&business_id=`, `POST /tasks/{id}/approve`, `POST /tasks/{id}/reject` (a note teaches the playbook), `GET /activity`, `GET/PUT /playbook` |

## Layout

```
app/
  main.py          FastAPI app, routers, scheduler start/stop
  config.py        settings from env / the shared root .env
  db.py            engine, session, base classes
  models.py        all tables
  auth.py          session cookie -> user (own accounts; optionally the CRM cookie)
  schemas.py       request bodies
  routers/         HTTP layer only (businesses, connections, discover, growth, keyword_trends, ...)
  audit/           on-page crawler, PageSpeed/Lighthouse, sitemap, SSRF checks, GBP scoring, audit orchestration
    routers/         website + lighthouse audit endpoints
  services/        the logic
    pipeline.py      onboarding: email -> audited, scheduled client
    extraction.py    business details from an email (rules + grounded AI)
    intake.py        IMAP mailbox / webhook
    gbp.py           Google OAuth + Business Profile APIs
    google_trends_client.py  HTTP client for the google_trends microservice
    providers/       DataForSEO adapters + sample data
    geo.py           GEO / AEO tracker
    agent.py         planner, approvals, apply
    schedules.py     per-business jobs
    scheduler.py     background loop
    reports.py       monthly summary + PDF
    playbook.py      SOP, approval rules, plan schedules
migrations/        Alembic (0001 initial schema, 0002 FAQs, 0003 users, 0004 Lighthouse audits)
tests/
```

---

# google_trends: keyword-research microservice

Standalone keyword-research service built on the unofficial
[`pytrends`](https://github.com/GeneralMills/pytrends) client. This folder is self-contained — it
does not import from, or modify, `backend/` or `frontend/` — so it can be run, restarted and
debugged independently. The backend talks to it only over HTTP, via
`backend/app/services/google_trends_client.py` and the `/api/v1/keyword-trends/*` proxy router.

## Run it

```bash
cd backend/google_trends
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8100
```

Call the API directly, or through the backend's `/api/v1/keyword-trends/*` proxy.

## Endpoints

- `GET /api/keywords/trends?keyword=&country=&timeframe=` — interest-over-time + a calculated trend summary
- `GET /api/keywords/related?keyword=&country=&timeframe=&limit=` — top / rising / breakout related queries, expanded toward `limit` (default 50) by re-querying extra seed keywords when a single Google Trends call returns fewer
- `GET /api/keywords/planner?keyword=&country=&timeframe=&limit=&regional_limit=` — combines the above plus regional interest and a candidate-keyword list
- `GET /api/keywords/explore?keywords=&country=&state=&category=&timeframe=&limit=&regional_limit=` — Google Trends "Explore"-style endpoint: compare up to 5 keywords side by side, narrowed to a country or a specific state/region, filtered by category, over one of Google's own lookback windows
- `GET /api/keywords/categories` — the real top-level Google Trends category taxonomy
- `GET /health` — liveness check

`country` is a 2-letter code (default `IN`). `timeframe` (for `/trends`, `/related`, `/planner`) is
one of `past_day`, `past_7_days`, `past_30_days`, `past_90_days`, `past_12_months`.

### `/api/keywords/explore` parameters

- `keywords` — comma-separated, 1-5 keywords, e.g. `keywords=seo audit,seo tool`
- `country` — 2-letter code (default `IN`)
- `state` — optional ISO 3166-2 region code without the country prefix, e.g. `KA` for Karnataka, `DL`
  for Delhi. Combined with `country` into Google's geo format (`IN-KA`). Google Trends has no
  free-text city targeting — country and first-level region are the most granular "location" it
  supports; when a state is given, the regional-interest breakdown switches to city-level results
  within that state.
- `category` — a dropdown of the real top-level Google Trends categories (e.g. `finance`,
  `arts_and_entertainment`), default `all_categories`. See `GET /api/keywords/categories` for the
  full list with ids and names.
- `timeframe` — one of `past_hour`, `past_four_hours`, `past_24_hours`, `past_week`, `past_month`,
  `past_3_months`, `past_year`, `past_5_years` (matches Google Trends' own Explore UI options)

The category list is pulled from `TrendReq().categories()` (Google's own taxonomy), not guessed, so
the ids match what Google Trends itself uses.

## Data accuracy

Google Trends scores are **relative, normalized search-interest values on a 0–100 scale** — not
absolute search volume. This service does not and will not report, estimate, or fabricate:

- Exact monthly search volume
- Keyword difficulty
- Cost per click (CPC) or paid-ad competition
- Exact keyword ranking positions

Any field Google Trends doesn't return for a given keyword/region/timeframe combination comes back
as `null` (rendered as "Not available" in the UI) rather than a guessed value.

## Reliability notes

`pytrends` scrapes Google Trends' internal, undocumented endpoints — it has no SLA and can break or
get rate-limited at any time. To reduce the blast radius:

- All upstream calls are serialized (one at a time) and spaced out by
  `GOOGLE_TRENDS_MIN_REQUEST_INTERVAL_SECONDS` to avoid triggering 429s.
- Failed calls are retried up to `GOOGLE_TRENDS_MAX_RETRIES` times with backoff before surfacing a
  `503`.
- Successful responses are cached in-memory for `GOOGLE_TRENDS_CACHE_TTL_SECONDS` (per
  keyword/country/timeframe) to cut down on repeat requests.
- When a single call doesn't return enough related/rising keywords to reach the requested `limit`
  (default 50), a few of the returned keywords are used as extra seeds and re-queried, merging in
  their own related/rising queries (deduplicated) — this costs one extra Google Trends request per
  extra seed, so it adds latency in exchange for more results.
- All Google Trends access goes through `app/services/trends_client.py`. If `pytrends` needs to be
  swapped for another provider later, that's the only module that has to change.

## Tests

```bash
pytest -q
```

Tests mock `pytrends` responses (via `app.services.trends_client`) — they never hit the real Google
Trends service.
