# Codigix SEO Platform: backend

The API for the SEO platform (the GREXA-style blueprint). It has its own code, its own database, its own users and its own process; it shares nothing with the CRM. The web app that uses it is in [`../frontend`](../frontend), and [`../README.md`](../README.md) explains how to run both.

**Stack:** Python 3.12+ · FastAPI · SQLAlchemy 2 · PostgreSQL · Alembic · APScheduler · httpx · BeautifulSoup · OpenAI-compatible AI.

## What it does

An onboarding email reaches a dedicated mailbox. From there the service runs every step with no manual work:

1. **Intake** reads the mailbox (IMAP) or accepts a webhook POST. Only emails from the team's addresses are accepted.
2. **Extraction** pulls the business out of the email. A rule-based reader runs first, so it works without AI. The AI's answer is kept only where it matches the email text. If the name or phone is missing, it emails the sender back to ask.
3. **Profile**: the business is created, or matched to an existing one by phone, website or name.
4. **GBP match** links the business to a location under a connected Google account, then pulls in its reviews, photo count and daily calls, directions and clicks.
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

**Lighthouse audits** (no business needed) run a full Google Lighthouse report on any URL, or on every page in a site's `sitemap.xml` (up to 50). They return scores, Core Web Vitals, CrUX field data, opportunities, diagnostics, and failed and passed audits, plus the raw JSON and HTML reports for download. There are two engines:

- **PageSpeed Insights** (`PAGESPEED_API_KEY`): Lighthouse runs on Google's servers.
- **Local Lighthouse CLI**: Node.js, `npm install -g lighthouse`, and Chrome or Edge on this server. It writes the original Lighthouse HTML.

If PageSpeed fails, the audit falls back to the local engine and records why. Scores always come from a real Lighthouse run. If neither engine works, the audit fails with the reason.

Every URL is checked for SSRF before it is queued and again before it runs. It must be http(s) with no credentials, and every DNS answer must be public. Chrome is pinned to the IP that was checked. Each engine has its own worker limit. Unfinished audits are marked failed when the server restarts. Report files are kept in `LIGHTHOUSE_REPORTS_DIR`.

**Approvals:** anything that reaches Google or the website is an **agent task**. A task is applied only after approval, unless the playbook allows autopilot for that kind. Profile edits always ask. Every action goes to the activity log.

## Data sources

| Feature | Live with | Without it |
|---|---|---|
| GBP profiles, reviews, insights, replies, posts | Google OAuth client (Business Profile API approved) | Businesses entered by email or by hand |
| Technical SEO | `PAGESPEED_API_KEY` | Audit fails with a clear message |
| Lighthouse audits | `PAGESPEED_API_KEY` and/or local Node.js + `lighthouse` + Chrome | Audit fails with a clear message |
| On-page SEO | Built-in crawler | Always live |
| Rank grid, citations, link sources | `SERPER_API_KEY` (live Google results) | Sample data, labelled `sample` |
| Domain Overview, Organic Rankings, Top Pages | A Google account that can see the site in Search Console | Says what is missing; nothing is estimated |
| Citations | No licensed source chosen yet | Sample data |
| GEO / AEO | OpenAI, Gemini, Perplexity, Anthropic, DeepSeek keys | Sample data |
| AI drafts, extraction, reports | `AI_PROVIDER` key | Rule-based extraction; template report; no drafts |

## Run it

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.lock                    # exact tested versions (requirements.txt = ranges)
cp .env.example .env                                # then fill in SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
# create the database once:  CREATE DATABASE seo_platform_db;
alembic upgrade head
uvicorn app.main:app --port 8100
```

Interactive API docs are at http://localhost:8000/docs.

**Production:** run one instance with the scheduler (`SCHEDULER_ENABLED=true`). If you run more API instances, set `SCHEDULER_ENABLED=false` on the others.

## Tests

```bash
pip install -r requirements-dev.txt   # adds pytest on top of requirements.txt
pytest -q
```

The tests use a throwaway SQLite database, with no network and no AI. They cover:
- the profile score;
- email extraction (labelled, loose and missing-phone emails);
- crawler page checks and AI-answer analysis;
- login (own accounts, password hashing, admin-only user management) and refusal of bad tokens;
- the full onboarding pipeline end to end (steps, audits, the Growth plan's schedules, approvals, report PDF, duplicate handling);
- needs-info emails, sender filtering, the webhook token, rank scans, keywords, and the playbook;
- Lighthouse audits: SSRF checks, both engines and the fallback, report normalisation, sitemap discovery, duplicates, re-runs, downloads, rate limits, site audits and restart recovery (DNS and HTTP are faked).

One test really runs Node, Lighthouse and Chrome against example.com. It is skipped unless `RUN_LIVE_TESTS=1` is set.

## API (prefix `/api/v1`)

| Area | Endpoints |
|---|---|
| System | `GET /health`, `GET /me`, `GET /status` |
| Login | `POST /auth/login`, `POST /auth/logout`, `GET/POST /users`, `PATCH /users/{id}` (admins) |
| Businesses | `GET/POST /businesses`, `GET/PATCH/DELETE /businesses/{id}`, `GET /businesses/{id}/overview`, `GET /businesses/{id}/gbp/score`, `POST /businesses/{id}/sync` |
| Audits | `POST /businesses/{id}/audits` (background), `GET /businesses/{id}/audits`, `GET /businesses/{id}/audits/{audit_id}` |
| Website check | `POST /website-audits` → `{id}`, `GET /website-audits/{id}`, `GET /website-audits` (history) |
| Lighthouse | `POST /lighthouse/audits` `{url, strategy: mobile\|desktop, engine: pagespeed\|lighthouse}` → `{id, status, status_url}`, `GET /lighthouse/audits/{id}`, `GET .../{id}/report`, `GET .../{id}/download/json`, `GET .../{id}/download/html`, `POST .../{id}/rerun`, `GET /lighthouse/audits/history?page=&page_size=`, `POST /lighthouse/site-audits` `{url, strategy, engine, max_pages}`, `GET /lighthouse/site-audits/{id}`, `GET /lighthouse/site-audits/history`, `GET /lighthouse/health` |
| Intake | `GET /intake/emails`, `GET /intake/emails/{id}`, `POST /intake/emails` (paste), `POST /intake/webhook` (header `X-Intake-Token`), `POST /intake/emails/{id}/process`, `POST /intake/poll` |
| Google | `GET /connections`, `GET /connections/google/start` → sign-in URL, `GET /connections/google/callback`, `GET /connections/{id}/locations`, `POST /connections/{id}/import`, `POST /connections/{id}/sync`, `DELETE /connections/{id}` |
| Profile | `GET/POST /businesses/{id}/posts`, `POST /businesses/{id}/posts/draft`, `GET /businesses/{id}/reviews`, `POST /businesses/{id}/reviews/{rid}/draft`, `POST /businesses/{id}/reviews/{rid}/approve` |
| Growth | `GET/POST /businesses/{id}/keywords`, `POST .../keywords/ideas`, `POST .../keywords/cluster`, `POST/GET .../rank-scans`, `GET .../geo`, `POST .../geo/prompts`, `POST .../geo/run`, `GET .../backlinks`, `GET .../citations` |
| Leads | `GET/POST /businesses/{id}/leads`, `PATCH .../leads/{lid}?status=`, `GET .../insights?days=` |
| Reports | `GET /businesses/{id}/report?month=YYYY-MM`, `GET /businesses/{id}/report.pdf` |
| Schedules | `GET/PUT /businesses/{id}/schedules` |
| Agent | `GET /tasks?status=&business_id=`, `POST /tasks/{id}/approve`, `POST /tasks/{id}/reject` (a note teaches the playbook), `GET /activity`, `GET/PUT /playbook` |

## Backlink Intelligence (our own discovery bot)

No third-party link index is used. The bot lives in `app/backlinks/` and the page is **Link Building → Backlink Intelligence**.

Flow, start to end:

1. **Targets**: add your site and your competitors (`POST /businesses/{id}/backlink-intel/targets`).
2. **Discovery bot** tab: *Run now*, or tick *Run automatically* (the scheduler runs it every N minutes). It starts at each tracked site, reads
   `robots.txt` and sitemaps, follows links outward (0 to 3 steps), and records every link it finds to a tracked domain. It obeys
   `robots.txt`, waits between requests to the same host, refuses private addresses (SSRF guard), skips giant platforms, and stops at the
   page budget you set.
3. **Seeds & verify** tab: give it pages that should link to you; re-check links it already found. A link only counts as lost after
   two consecutive clean fetches without it; a failed fetch (403/429/5xx/timeout) never marks a link lost.
4. **Overview / Backlink explorer / Competitor gap**: reports computed from what the bot found. Review decisions (whitelist, disavow,
   removal outreach) are stored per business and a Google-format disavow file can be downloaded.

The bot only finds links on pages it can reach by following links from your sites, so coverage grows with each run but is smaller than a
commercial index. Give it seed pages to widen it.

5. **Removal requests**: select one referring domain in the Overview table and choose *Draft removal email*. With an AI key the wording is
   written by the model (it must name the real linking pages); otherwise a plain template is used. Nothing is sent: copy it into your email.
6. The dashboard, Domain Overview and the assistant show the same live-link totals the bot found for your own site.

Tests: `python -m pytest tests/test_backlinks.py` (the bot runs against a simulated web, no network).

To run the whole suite on PostgreSQL instead of SQLite (the tables are created and dropped, so the database name must contain "test"):

```
createdb seo_test
TEST_DATABASE_URL=postgresql+psycopg://user:password@localhost/seo_test python -m pytest
```

Or, with Docker: `docker compose -f docker-compose.test.yml up -d`, then `TEST_DATABASE_URL=postgresql+psycopg://seo:seo_test_pw@localhost:55432/seo_test python -m pytest`.
The suite has been run on SQLite only; every backlink table and query compiles for PostgreSQL, but a green run on a real PostgreSQL is still to be done.

Run `alembic upgrade head`: the migration history has a single head again (`0019_merge_heads`).

## AI layer

### Publishing blogs to a customer's website

1. **Onboarding reads the site's technology.** When a project is created (or its website changes) the platform fingerprints the site in the background
   (`services/site_stack.py`): CMS or framework, language, hosting/CDN, plugins, analytics, and whether it has a blog. The onboarding run shows it as a step.
2. **Blog tab > Publish & Schedule** uses that result: it recommends the method that fits the stack and explains it (the text comes from the server).
3. **Methods** (`services/site_publish.py`, `services/site_adapters.py`): WordPress (Application Password), Ghost (Admin API key), Shopify (custom-app token),
   GitHub (a Markdown file with front matter committed to the site's repo, for Next.js/Gatsby/Astro/Hugo/Jekyll and other code-based sites) and a signed webhook
   (the way in for Wix, Squarespace, Webflow and other builders that have no write API we can use). Each connection is checked step by step before it is saved.
4. **Scheduling**: WordPress, Ghost and Shopify schedule natively. GitHub has no "publish later", so GrowZen holds the post (`scheduled_posts`) and the scheduler
   commits it at the chosen time (retries three times, ten minutes apart; cancel from the panel).

Tested against simulated WordPress, GitHub, Ghost, Shopify and webhook servers (`tests/test_site_publish.py`, `test_site_adapters.py`, `test_site_stack.py`). A real
customer's token or host rules are what the connect-time checks verify; set `SITE_AUTODETECT=false` to turn the background reading off.

### JavaScript pages and the weekly competitor watch

- **Read JavaScript pages** (Discovery bot tab, off by default): pages that are an empty app shell until JavaScript runs are loaded in headless Chrome, at most 10 per run.
  The browser is pinned to the validated IP of the page's own host and every other hostname fails to resolve, so page scripts cannot reach internal services or third
  parties; pages that need an outside CDN to render come back unrendered. Needs Chrome/Edge/Chromium (`CHROME_PATH` to point at it; `CHROME_NO_SANDBOX=1` inside containers).
- **Competitor watch** (sidebar: Competitor Watch): every week, for each competitor you track, the bot reads up to 25 pages (home page, newly listed pages, then those not
  seen for longest) and compares them with last week: new pages, changed titles/headings/descriptions or large rewrites, removed pages (confirmed by a 404/410). The first
  visit only sets the baseline. A summary is written from those facts (AI when a key is set, a template otherwise; an AI answer that names a site it was not given is discarded).

### What the AI does on the backlink data

Every feature has a rule-based fallback and says which one produced the answer (`source` / `method`). All of them answer from facts the bot collected and
validate the model's JSON; anything invalid is discarded, never shown.

| Feature | Where | Endpoint |
|---|---|---|
| Link quality score (relevance, spam risk, reason) | Overview table, "Score with AI" | `POST /businesses/{id}/backlink-intel/scores/run` |
| Gap prioritiser (win chance + honest approach) | Competitor gap tab | `POST .../gap/prioritize` |
| "Explain what changed" | Overview | `POST .../explain` |
| Removal-request email draft | Domains table | `POST .../reviews/draft-removal` |
| Bot results become tasks and activity | Autonomous AI Agents (Outreach), Activity | automatic after each bot run |
| Before/after measurement of actions (14 and 30 days) | Autonomous AI Agents, "What worked" | `GET /businesses/{id}/outcomes` |
| Assistant that proposes actions you confirm | Chat widget | `POST /businesses/{id}/assistant/actions` |

The bot only files a removal task for clearly spammy linkers (risk 70 or more), never for a client who credits you in their footer.


`app/services/ai.py` talks to DeepSeek, OpenAI, Gemini or Claude. Transient failures are retried with backoff (honouring `Retry-After`);
if the chosen provider keeps failing, the next provider that has an API key is tried. Claude's model comes from `CLAUDE_MODEL`.

## Layout

```
app/
  main.py          FastAPI app, routers, scheduler start/stop
  config.py        settings from env / .env
  db.py            engine, session, base classes
  models.py        all tables
  auth.py          session cookie -> user (own accounts; optionally the CRM cookie)
  schemas.py       request bodies
  routers/         HTTP layer only
  services/        the logic
    pipeline.py      onboarding: email -> audited, scheduled client
    extraction.py    business details from an email (rules + grounded AI)
    intake.py        IMAP mailbox / webhook
    gbp.py           Google OAuth + Business Profile APIs
    audits.py        run and store audits
    profile_score.py GBP score
    pagespeed.py     PageSpeed Insights
    lighthouse.py    local Lighthouse CLI (Node + Chrome)
    lighthouse_report.py  Lighthouse JSON -> normalised report, summary HTML
    lighthouse_runner.py  Lighthouse audit queue: per-engine workers, fallback, storage
    sitemap.py       pages from sitemap.xml (site audits)
    url_safety.py    SSRF checks, DNS-pinning HTTP transport
    crawler.py       on-page / technical crawler
    providers/       Serper adapters + sample data
    geo.py           GEO / AEO tracker
    agent.py         planner, approvals, apply
    schedules.py     per-business jobs
    scheduler.py     background loop
    reports.py       monthly summary + PDF
    playbook.py      SOP, approval rules, plan schedules
migrations/        Alembic (0001 initial schema, 0002 FAQs, 0003 users, 0004 Lighthouse audits)
tests/
```
