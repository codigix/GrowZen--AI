# Website Lighthouse Audit Tool

A self-contained FastAPI application that runs **real** Google Lighthouse audits
against any publicly accessible URL, using either:

- **Google PageSpeed Insights API** (hosted Lighthouse, no local Chrome needed), or
- **Local Lighthouse CLI** (Node.js + Chrome/Chromium, run on your own machine)

and shows the results (scores, Core Web Vitals, opportunities, diagnostics,
passed/failed audits) in a dashboard served directly by FastAPI — no separate
frontend build step. Scores are **never** invented, simulated, or hardcoded:
every number comes from an actual Lighthouse run.

## 1. Quick start (Windows)

1. Install [Python 3.11+](https://www.python.org/downloads/) (check "Add
   python.exe to PATH").
2. (Optional, for the local Lighthouse engine) install
   [Node.js LTS](https://nodejs.org/) and then:
   ```
   npm install -g lighthouse
   ```
   Chrome or Microsoft Edge (Chromium-based) must also be installed; the
   Lighthouse CLI will auto-detect an installed Chrome/Chromium.
3. Double-click `run_windows.bat`, or run it from a terminal:
   ```
   run_windows.bat
   ```
   This creates a virtual environment, installs Python dependencies, copies
   `.env.example` to `.env` on first run, checks for Node/Lighthouse, and
   starts the server.
4. Open **http://127.0.0.1:8000** in your browser.

## 2. Manual setup (any OS)

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
copy .env.example .env        # or: cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## 3. Choosing an engine

You do **not** need both engines configured — pick whichever fits:

| Engine | Needs | Notes |
|---|---|---|
| **PageSpeed Insights** | `PAGESPEED_API_KEY` env var | Audits run on Google's infrastructure, no local browser needed. Subject to Google API quotas. |
| **Local Lighthouse** | Node.js + `npm install -g lighthouse` + Chrome/Chromium | Full control, no external API quota, but slower and uses local CPU. |

### Getting a PageSpeed API key
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project, enable the **PageSpeed Insights API**.
3. Create an API key (Credentials → Create Credentials → API key).
4. Put it in `.env` as `PAGESPEED_API_KEY=...`.

The app starts fine with this unset — the PageSpeed option is simply reported
as "not configured" (via `/api/health`) and rejected with a clear error if
selected, while the local Lighthouse engine still works.

## 4. Using the dashboard

1. Enter a `http://` or `https://` URL.
2. Choose **Mobile** or **Desktop**.
3. Choose **Google PageSpeed Insights** or **Local Lighthouse CLI**.
4. Click **Run Audit** and wait — audits can take anywhere from a few
   seconds (PageSpeed) to a couple of minutes (local Lighthouse).
5. Review the four category scores, Core Web Vitals / lab metrics, and
   expandable sections for failed audits, opportunities, diagnostics, passed
   audits, and manual checks.
6. Download the raw JSON report, the HTML report (the *original* Lighthouse
   HTML when using the local engine, or a clearly labeled generated summary
   when using PageSpeed, since PSI does not return an HTML report), or
   re-run the audit.
7. Browse **Audit History** at the bottom and click a completed row to
   reopen that report — history and reports survive an application restart.

## 5. REST API

| Method | Path | Description |
|---|---|---|
| POST | `/api/audits` | Start an audit. Body: `{"url", "strategy": "mobile"\|"desktop", "engine": "pagespeed"\|"lighthouse"}`. Returns `{id, status, status_url}` (HTTP 201). |
| POST | `/api/audits/{id}/rerun` | Re-run a previous audit's URL/strategy/engine as a new audit. |
| GET | `/api/audits/{id}` | Audit status/summary. |
| GET | `/api/audits/{id}/report` | Normalized report: scores, metrics, categorized audits, field data. |
| GET | `/api/audits/{id}/download/json` | Raw Lighthouse JSON (404 if not available). |
| GET | `/api/audits/{id}/download/html` | Original Lighthouse HTML (local engine) or a labeled generated summary HTML (PageSpeed). |
| GET | `/api/audits/history?page=1&page_size=20` | Paginated history. |
| GET | `/api/health` | Engine configuration/availability status (no secrets exposed). |

Example:
```bash
curl -X POST http://127.0.0.1:8000/api/audits \
  -H "Content-Type: application/json" \
  -d '{"url": "https://codigix.co/", "strategy": "mobile", "engine": "pagespeed"}'
```

## 6. Configuration (`.env`)

```
PAGESPEED_API_KEY=
PAGESPEED_ENABLED=true
LOCAL_LIGHTHOUSE_ENABLED=true
AUDIT_TIMEOUT_SECONDS=180
MAX_CONCURRENT_AUDITS=2
MAX_CONCURRENT_PAGESPEED_AUDITS=8
DATABASE_URL=sqlite:///./audits.db
REPORTS_DIR=./reports
RATE_LIMIT_PER_MINUTE=10
HOST=127.0.0.1
PORT=8000
```

## 7. Architecture notes

- **Persistence**: SQLite via SQLAlchemy (`app/models/audit.py`). Every
  audit is written to the database *before* it runs (status `queued`), and
  report files (JSON/HTML) are written under `REPORTS_DIR` — both survive a
  server restart. Any audit still `queued`/`running` at startup (e.g. the
  process crashed mid-run) is marked `failed` with an explanatory message,
  since no in-memory worker can resume it.
- **Execution model**: audits run as `asyncio` tasks gated by **two separate
  semaphores**, one per engine: `MAX_CONCURRENT_AUDITS` bounds local
  Lighthouse runs (each spawns a real Chrome process, so it's CPU/RAM
  bound and kept conservative), while `MAX_CONCURRENT_PAGESPEED_AUDITS`
  bounds PageSpeed Insights runs (just an HTTP call to Google's
  infrastructure, so it can safely run with much higher concurrency). This
  means a multi-page site audit using one engine isn't throttled by the
  other engine's limit, and pages run in parallel up to each engine's cap
  rather than one at a time. This is adequate for local/single-instance use.
  **For a production deployment serving many concurrent users, replace this
  with a real task queue (RQ/Celery + Redis)** so jobs survive process
  restarts and can be distributed across worker processes — the
  persistence layer is already structured so that swap doesn't change the
  API surface.
- **Rate limiting**: a simple in-memory sliding window on `POST
  /api/audits` (`RATE_LIMIT_PER_MINUTE`). Single-process only; a
  multi-instance deployment should move this to a shared store.
- **SSRF protection** (`app/security/url_validation.py`): only `http`/`https`
  URLs with no embedded credentials are accepted; the hostname is resolved
  via DNS and *every* resolved address is checked against loopback,
  private, link-local, multicast, reserved, unspecified, carrier-grade NAT,
  and cloud-metadata ranges before an audit is queued. For the local
  Lighthouse engine, the validated IP is pinned into Chrome via
  `--host-resolver-rules` so a DNS-rebinding attack (safe IP at validation
  time, internal IP at fetch time) can't bypass the check. For the
  PageSpeed engine, the actual page fetch happens on Google's
  infrastructure, not this server, so SSRF protection there is necessarily
  limited to pre-validating the URL shape/DNS before sending it to Google.
- **Subprocess safety** (`app/audit_engines/lighthouse.py`): the Lighthouse
  CLI is invoked by running `node <lighthouse>/cli/index.js <args>` via
  `subprocess.Popen` with an explicit argument list (run in a worker thread
  via `asyncio.to_thread`) — never through a shell, and never via the
  Windows `.cmd` wrapper (which would require `cmd.exe` to parse the
  command line and reintroduces metacharacter-injection risk). The
  submitted URL is passed as a single argv entry and is never concatenated
  into a command string. Blocking `subprocess.Popen` is used instead of
  `asyncio.create_subprocess_exec` because the latter requires a
  `ProactorEventLoop` on Windows; uvicorn switches to
  `WindowsSelectorEventLoopPolicy` whenever run with `--reload` or multiple
  workers, and `SelectorEventLoop` has no subprocess support on Windows at
  all. Running the blocking call in a thread sidesteps that entirely.

## 8. Testing

```bash
pytest
```

Runs unit tests for URL validation/SSRF, PageSpeed response parsing
(mocked via `respx`), local Lighthouse CLI discovery/error handling (process
execution mocked), report normalization, and the full audit API lifecycle
(engine calls mocked, real SQLite persistence). All of the above were run
and passed in this environment (49 passed, 1 skipped) as of this writing.

An **optional live integration test** actually launches Node + Lighthouse +
Chrome against `https://example.com`. It is skipped unless you opt in by
setting `RUN_LIVE_TESTS=1`:
```bash
RUN_LIVE_TESTS=1 pytest -k live          # bash
set RUN_LIVE_TESTS=1 && pytest -k live   # Windows cmd
```
This was executed manually against `https://example.com` during
development (see section 9) using the running server rather than the
pytest marker, confirming a real end-to-end Lighthouse run.

## 9. What was manually verified in this environment

Using the actual installed Node 24 / Lighthouse 13.5.0 / Chrome 155 on this
machine, the following were run for real (not mocked) against
`https://example.com`:
- `POST /api/audits` with `engine=lighthouse` → real Chrome launch, real
  Lighthouse run, completed in ~15s with scores
  Performance 99, Accessibility 96, Best Practices 100, SEO 80.
- `GET /api/audits/{id}/report`, `/download/json`, `/download/html` — all
  returned the real Lighthouse JSON/HTML.
- `GET /api/audits/history` — showed the completed audit.
- Restarting the server (`uvicorn` process killed and relaunched) — the
  same audit was still visible in history and its JSON report still
  downloadable, confirming restart-safe persistence.
- SSRF protection: a request for `http://169.254.169.254/...` (cloud
  metadata address) was rejected with HTTP 400 before any audit was queued.

**PageSpeed Insights was not live-tested** in this environment because no
`PAGESPEED_API_KEY` was available; `/api/health` correctly reports
`pagespeed_configured: false` in that case, and selecting that engine
returns a clear "not configured" error instead of a fabricated result. Set
`PAGESPEED_API_KEY` in `.env` to use/test it yourself.

## 10. Troubleshooting

- **"Local Lighthouse engine is not available"** — Node.js and/or the
  `lighthouse` npm package were not found. Run `npm install -g lighthouse`
  and verify `node --version` works from the same terminal used to launch
  the app.
- **Lighthouse fails with a Chrome-launch error** — install Google Chrome
  or Microsoft Edge; Lighthouse auto-detects common install locations. On
  a locked-down machine you may need `--no-sandbox` (already applied by
  default here) or to run as a less-restricted user.
- **PageSpeed Insights returns a quota error** — Google enforces a daily
  quota per API key; wait and retry, or request a quota increase in Google
  Cloud Console.
- **PageSpeed Insights "URL is not accessible"** — Google's crawler could
  not reach the URL (it may be behind auth, geo-blocked, or require
  JavaScript Google couldn't render); try the local Lighthouse engine
  instead.
- **Audits stuck at "queued"** — all slots for that audit's engine are
  busy (`MAX_CONCURRENT_AUDITS` for local Lighthouse,
  `MAX_CONCURRENT_PAGESPEED_AUDITS` for PageSpeed Insights); wait for an
  in-flight audit to finish, or raise the relevant limit in `.env`.
- **Reports disappear after restart** — make sure `REPORTS_DIR` and
  `DATABASE_URL` point at persistent paths (the defaults do) and that
  nothing else is deleting that directory between runs.

## 11. Project structure

```
app/
    main.py                  FastAPI app, middleware, dashboard route
    config.py                Environment-driven settings
    database.py               SQLAlchemy engine/session/init
    models/audit.py           Audit ORM model
    schemas/audit.py          Pydantic request/response schemas
    api/audits.py             Audit REST endpoints
    api/health.py             Health endpoint
    services/audit_service.py Orchestration, concurrency, persistence
    services/report_service.py Lighthouse JSON normalization + summary HTML
    audit_engines/pagespeed.py  Engine A: PageSpeed Insights API
    audit_engines/lighthouse.py Engine B: local Lighthouse CLI
    security/url_validation.py  SSRF protection
    templates/dashboard.html    Dashboard page
    static/styles.css, dashboard.js
tests/                        pytest suite (see section 8)
reports/                      Generated JSON/HTML reports (git-ignored)
requirements.txt
.env.example
run_windows.bat
```
