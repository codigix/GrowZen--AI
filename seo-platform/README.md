# Codigix SEO Platform

A standalone app for running local SEO for clients. You paste or forward an onboarding email, or connect the owner's Google account. The platform then finds the business, audits it, plans the work and keeps it running on a schedule. It is completely separate from the CRM: it has its own code, database, users and processes.

```
seo-platform/
  backend/     Python FastAPI API + PostgreSQL (SQLite for local dev) + scheduler   → port 8100
  frontend/    React (Vite + Tailwind) web app with every SEO page                  → port 3100
```

## Run it locally (two terminals)

**Backend: terminal 1**

```bash
cd seo-platform/backend
python -m venv .venv
.venv\Scripts\activate                 # Linux/macOS: source .venv/bin/activate
pip install -r requirements.lock
copy .env.example .env                 # Linux/macOS: cp; then set SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
alembic upgrade head                   # creates / updates the database tables
uvicorn app.main:app --port 8100
```

API docs: http://localhost:8100/docs

**Frontend: terminal 2**

```bash
cd seo-platform/frontend
npm install
npm run dev
```

Open http://localhost:3100 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. That admin account is created automatically the first time the backend starts, as long as the database has no users yet. Add more people under **Users** in the sidebar. The roles are admin, editor and viewer.

## Database

- **Local dev:** `DATABASE_URL=sqlite:///./seo_platform_dev.db` stores everything in a single file in `backend/`.
- **Real use:** PostgreSQL. Create the database once (`CREATE DATABASE seo_platform_db;`), then set `DATABASE_URL=postgresql+psycopg://user:password@host:5432/seo_platform_db`.
- After pulling new code, run `alembic upgrade head` again.

## Settings

All settings go in `backend/.env`; see `backend/.env.example` for the full list. Without a key, the matching feature uses sample data (shown with a "sample data" label) or stays off. The **Connections & Plans** page shows what is currently connected.

| Setting | Turns on |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Connect Google account": imports the Business Profiles that account manages. Register `http://localhost:8100/api/v1/connections/google/callback` as a redirect URI and enable the Business Profile APIs |
| `GOOGLE_PLACES_API_KEY` | "Find by email": finds a business on Google Maps from an email address and its website |
| `PAGESPEED_API_KEY` | Technical SEO audit |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | Live rank grid, keyword volumes, backlinks |
| `AI_PROVIDER` + `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | AI drafts (posts, review replies, descriptions), email reading, reports |
| `INTAKE_IMAP_*`, `SMTP_*` | Reading the onboarding mailbox; sending reports and replies |

The frontend has one setting, `VITE_API_URL` (in `frontend/.env`). Its default is `http://localhost:8100/api/v1`.

## Production

1. `cd frontend && npm run build`. This writes `frontend/dist`.
2. Run the backend. When `frontend/dist` exists, the backend serves the web app at the same address as the API, so only one process and one port are needed. Set `FRONTEND_URL` and `PUBLIC_BASE_URL` to that public address and `COOKIE_SECURE=true` (HTTPS). Use a long random `SECRET_KEY`.
3. Run a single backend instance with `SCHEDULER_ENABLED=true`. If you run extra instances, set it to `false` on them.

## Tests

```bash
cd seo-platform/backend
pytest -q
```

More detail on the pipeline, audits, data sources and API is in [`backend/README.md`](backend/README.md).
