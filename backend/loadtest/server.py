"""The backend for the load tests: the real application on a dedicated test database, with the slow OUTSIDE services replaced by stand-ins that wait a fixed time.

    python loadtest/server.py <backend_dir> <port>      (environment: LOAD_DB_URL, FAKE_AI_SECONDS, FAKE_ADS_SECONDS, FAKE_XRAY_SECONDS, FAKE_LH_SECONDS)

Nothing leaves the machine: no AI, Google, Apify or website is called. Works with any version of the code (each stand-in is optional), so the same test can be run on the code before
and after the optimisations. /__load/stats reports threads, the database pool and (when present) the fan-out and background-job limits.
"""
import json
import os
import sys
import tempfile
import threading
import time

backend, port = sys.argv[1], int(sys.argv[2])
if os.environ.get("DUMP_STACKS_AFTER"):  # a stack dump of every thread after that many seconds, to see where a start-up that does not finish is waiting
    import faulthandler
    faulthandler.dump_traceback_later(int(os.environ["DUMP_STACKS_AFTER"]), exit=False, file=open(f"{os.environ.get('DUMP_STACKS_FILE', 'stacks')}.{os.getpid()}.txt", "w"))
sys.path.insert(0, backend)
os.chdir(backend)
url = os.environ["LOAD_DB_URL"]
if "load" not in url.rsplit("/", 1)[-1]:
    raise SystemExit("refusing: the database name must contain 'load'")
os.environ.update({"DATABASE_URL": url, "SECRET_KEY": "load-test-secret-0123456789-abcdefghijklmnop", "SCHEDULER_ENABLED": "false", "BACKLINK_AUTOSTART": "false",
                   "SITE_AUTODETECT": "false", "ALLOW_SAMPLE_DATA": "true", "ADMIN_EMAIL": "", "ADMIN_PASSWORD": "", "SCHEMA_AUTO_SYNC": "false", "LIGHTHOUSE_RATE_LIMIT_PER_MINUTE": "100000",
                   "TOKEN_ENCRYPTION_KEY": "aGol6LzAESrBGxyWgYQb0ObDl04ajkjTg_snnQRslJ4=", "COOKIE_SECURE": "false", "CSRF_ORIGIN_CHECK": "false"})
os.environ.update({k: "" for k in ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_PLACES_API_KEY", "GOOGLE_API_KEY", "PAGESPEED_API_KEY",
                                  "APIFY_KEY", *[f"APIFY_KEY_{n}" for n in range(1, 11)], "MOZ_ACCESS_ID", "MOZ_SECRET_KEY", "DATAFORSEO_AUTH", "SMTP_HOST", "CRAWLER_API_KEY", "CRM_API_URL")})  # nothing real can be reached
AI, ADS, XRAY, LH = (float(os.environ.get(k, d)) for k, d in (("FAKE_AI_SECONDS", "1.5"), ("FAKE_ADS_SECONDS", "0.5"), ("FAKE_XRAY_SECONDS", "1.5"), ("FAKE_LH_SECONDS", "3")))


def sleeper(seconds, value):
    def inner(*a, **k):
        time.sleep(seconds)
        return value() if callable(value) else value
    return inner


from app.main import app  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.services import ai  # noqa: E402

ai.is_configured = lambda: True
ai.complete = sleeper(AI, "A helpful reply.")
ai.complete_json = sleeper(AI, lambda: {"items": [], "priorities": [], "headline": "h", "title": "t", "body": "b", "hashtags": [], "faqs": []})
try:
    from app.services import google_ads_client as ads, keyword_metrics
    keyword_metrics.enabled = lambda: True
    ads.geo_target_for = lambda country: "geo"
    ads.keyword_ideas = sleeper(ADS, [])
    ads.historical_metrics = sleeper(ADS, {})
    from app.routers import seo
    seo._questions = lambda *a, **k: []
except Exception as exc:  # noqa: BLE001
    print("ads stand-ins skipped:", exc, flush=True)
try:
    from app.services import page_xray
    page_xray.run = sleeper(XRAY, {"ok": True})
except Exception as exc:  # noqa: BLE001
    print("page x-ray stand-in skipped:", exc, flush=True)
try:  # Lighthouse: the real runner and waiting code, with the audit itself replaced by one that takes LH seconds
    from app.services import lighthouse_runner
    from app.models import LighthouseAudit
    raw = os.path.join(tempfile.mkdtemp(), "lh.json")
    json.dump({"finalDisplayedUrl": "https://x.example/", "fetchTime": "2026-10-27T10:00:00Z", "categories": {"seo": {"score": 0.9, "auditRefs": []}, "performance": {"score": 0.5}}, "audits": {}},
              open(raw, "w"))

    def fake_execute(audit_id):
        time.sleep(LH)
        db = SessionLocal()
        a = db.get(LighthouseAudit, audit_id)
        if a is not None:
            a.status, a.raw_json_path, a.engine_used = "completed", raw, "pagespeed"
            db.commit()
        db.close()
    lighthouse_runner.execute = fake_execute
    lighthouse_runner.resolve_and_validate = lambda u: u
except Exception as exc:  # noqa: BLE001
    print("lighthouse stand-in skipped:", exc, flush=True)
try:  # article writing: the writer and its review stages wait a fixed time and report progress as the real one does
    from app.services import articles
    from app.services.seo_workflow import runner

    def fake_write(*args, **kw):
        progress = args[5]
        body = ""
        for i in range(4):
            time.sleep(0.5)
            body += f"<p>Section {i}. " + "Text. " * 80 + "</p>"
            progress(f"Writing section {i + 1} of 4", body=body)
        return {"title": "A load-test article", "meta": "A meta description", "tags": [], "body": body, "warnings": [], "stats": {"total_seconds": 2}}
    articles.write = fake_write
    runner.run_article_stages = lambda *a, **k: time.sleep(1.0)
except Exception as exc:  # noqa: BLE001
    print("article stand-ins skipped:", exc, flush=True)


try:  # competitors: Google Maps (the listing read, the search) wait a fixed time, and every read is recorded so the test can count them across all worker processes
    import loadprobe
    from app.services import maps_public
    from app.competitors import service as competitor_service
    MAPS = float(os.environ.get("FAKE_MAPS_SECONDS", "1.0"))
    LISTING = {"basics": {"name": "Rival", "category": "Dentist", "phone": "1", "website": "https://rival.example", "summary": "A dental clinic"},
               "reputation": {"photos": 12, "count": 150, "rating": 4.6, "reviews": []}, "hours": [1], "features": ["a", "b", "c"], "maps_url": "https://maps.example/rival"}

    def fake_read(pid, fresh=False):
        loadprobe.record("maps_read", str(pid))
        time.sleep(MAPS)
        return LISTING
    maps_public.read = fake_read
    competitor_service.find_competitors = sleeper(MAPS, lambda: [{"name": f"Rival {i}", "website": f"https://rival{i}.example", "address": "Pune"} for i in range(5)])
except Exception as exc:  # noqa: BLE001
    print("competitor stand-ins skipped:", exc, flush=True)


@app.post("/__load/probe/{key}", include_in_schema=False)
def start_probe(key: str):
    """Starts one background job the way the application does (written down in the database, run in a thread), so the test can kill this process mid-job and watch another take it over."""
    from app.services import durable
    durable.start_now(loadprobe.probe, key, refs=[f"probe:{key}"], name=f"probe-{key}")
    return {"pid": os.getpid()}


@app.get("/__load/stats", include_in_schema=False)
def load_stats():
    out = {"threads": threading.active_count(), "pool": engine.pool.status(), "checked_out": engine.pool.checkedout(), "pid": os.getpid()}
    try:
        from app.services import fanout
        out["fanout"] = fanout.stats()
    except Exception:  # noqa: BLE001
        out["fanout"] = None
    try:
        from app.services import durable
        out["job_places_free"] = durable._slots._value
        out["job_places_total"] = durable.MAX_BACKGROUND_JOBS
    except Exception:  # noqa: BLE001
        out["job_places_free"] = None
    return out


app.router.routes.insert(0, app.router.routes.pop())  # first in line: the catch-all route that serves the built frontend would otherwise answer it

import uvicorn  # noqa: E402

uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False, timeout_keep_alive=75)  # a client that pauses for a few seconds under load must find its connection open
