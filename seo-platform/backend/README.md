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

**Approvals:** anything that reaches Google or the website is an **agent task**. A task is applied only after approval, unless the playbook allows autopilot for that kind. Profile edits always ask. Every action goes to the activity log.

## Data sources

| Feature | Live with | Without it |
|---|---|---|
| GBP profiles, reviews, insights, replies, posts | Google OAuth client (Business Profile API approved) | Businesses entered by email or by hand |
| Technical SEO | `PAGESPEED_API_KEY` | Audit fails with a clear message |
| On-page SEO | Built-in crawler | Always live |
| Rank grid, keyword volume, backlinks | DataForSEO login | Sample data, labelled `sample` |
| Citations | No licensed source chosen yet | Sample data |
| GEO / AEO | OpenAI, Gemini, Perplexity, Anthropic, DeepSeek keys | Sample data |
| AI drafts, extraction, reports | `AI_PROVIDER` key | Rule-based extraction; template report; no drafts |

## Run it

```bash
cd seo-platform/backend
python -m venv .venv && .venv/Scripts/activate      # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.lock                    # exact tested versions (requirements.txt = ranges)
cp .env.example .env                                # then fill in SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
# create the database once:  CREATE DATABASE seo_platform_db;
alembic upgrade head
uvicorn app.main:app --port 8100
```

Interactive API docs are at http://localhost:8100/docs.

**Production:** run one instance with the scheduler (`SCHEDULER_ENABLED=true`). If you run more API instances, set `SCHEDULER_ENABLED=false` on the others.

## Tests

```bash
pytest -q
```

The tests use a throwaway SQLite database, with no network and no AI. They cover:
- the profile score;
- email extraction (labelled, loose and missing-phone emails);
- crawler page checks and AI-answer analysis;
- login (own accounts, password hashing, admin-only user management) and refusal of bad tokens;
- the full onboarding pipeline end to end (steps, audits, the Growth plan's schedules, approvals, report PDF, duplicate handling);
- needs-info emails, sender filtering, the webhook token, rank scans, keywords, and the playbook.

## API (prefix `/api/v1`)

| Area | Endpoints |
|---|---|
| System | `GET /health`, `GET /me`, `GET /status` |
| Login | `POST /auth/login`, `POST /auth/logout`, `GET/POST /users`, `PATCH /users/{id}` (admins) |
| Businesses | `GET/POST /businesses`, `GET/PATCH/DELETE /businesses/{id}`, `GET /businesses/{id}/overview`, `GET /businesses/{id}/gbp/score`, `POST /businesses/{id}/sync` |
| Audits | `POST /businesses/{id}/audits` (background), `GET /businesses/{id}/audits`, `GET /businesses/{id}/audits/{audit_id}` |
| Website check | `POST /website-audits` → `{id}`, `GET /website-audits/{id}`, `GET /website-audits` (history) |
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
    crawler.py       on-page / technical crawler
    providers/       DataForSEO adapters + sample data
    geo.py           GEO / AEO tracker
    agent.py         planner, approvals, apply
    schedules.py     per-business jobs
    scheduler.py     background loop
    reports.py       monthly summary + PDF
    playbook.py      SOP, approval rules, plan schedules
migrations/        Alembic (0001 initial schema, 0002 FAQs, 0003 users)
tests/
```
