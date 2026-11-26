"""Builds the seed database for the load tests: one admin, N users, and for each user one project with a realistic amount of data.

    python loadtest/seed.py <backend_dir> <database_url> [users]

Use a dedicated test database only (the name must contain "load"). Nothing here touches a real server.
"""
import json
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone

backend, url = sys.argv[1], sys.argv[2]
users = int(sys.argv[3]) if len(sys.argv) > 3 else 50
if "load" not in url.rsplit("/", 1)[-1]:
    raise SystemExit("refusing: the database name must contain 'load'")
sys.path.insert(0, backend)
os.chdir(backend)
os.environ.update({"DATABASE_URL": url, "SECRET_KEY": "load-test-secret-0123456789-abcdefghijklmnop", "SCHEDULER_ENABLED": "false", "BACKLINK_AUTOSTART": "false",
                   "ALLOW_SAMPLE_DATA": "true", "ADMIN_EMAIL": "", "ADMIN_PASSWORD": "",
                   "TOKEN_ENCRYPTION_KEY": "aGol6LzAESrBGxyWgYQb0ObDl04ajkjTg_snnQRslJ4="})

from app import models  # noqa: E402,F401
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import (AgentTask, AppUser, Article, Audit, Business, Competitor, InsightDay, Keyword, KeywordRankLog, Lead, Review, Schedule)  # noqa: E402
from app.services.passwords import hash_password  # noqa: E402

PASSWORD = "load-password-123456"
random.seed(42)
Base.metadata.create_all(engine)
db = SessionLocal()
pw = hash_password(PASSWORD)
now = datetime.now(timezone.utc)
db.add(AppUser(email="admin@load.test", name="Load Admin", role="admin", password_hash=pw))
db.commit()
PAGES = [{"url": f"https://shop{{n}}.example/page-{i}", "status": 200, "title": f"Page {i} title of the shop", "meta_description": "A description of the page " * 4, "h1": f"Heading {i}",
          "word_count": 400 + i, "top_keywords": [{"keyword": f"keyword {j}"} for j in range(6)], "images": 5, "links": 12} for i in range(60)]
for n in range(users):
    u = AppUser(email=f"u{n}@load.test", name=f"User {n}", role="manager", password_hash=pw)
    db.add(u)
    db.flush()
    b = Business(name=f"Load Business {n:02d}", primary_category="Dentist", city="Pune", website=f"https://shop{n}.example", status="active", owner_id=str(u.id),
                 services=[{"name": "Implants"}, {"name": "Whitening"}], goals=["More calls"], phone="+91 90000 00000", plan="Growth")
    db.add(b)
    db.flush()
    for i in range(15):
        db.add(Keyword(business_id=b.id, keyword=f"dentist service {i} pune", volume=random.randint(10, 900), tracked=True, rank=random.randint(1, 40), prev_rank=random.randint(1, 40),
                       cluster="Dental" if i % 2 else None, target_url=f"https://shop{n}.example/page-{i}" if i % 3 == 0 else None))
        for d in range(30):
            db.add(KeywordRankLog(business_id=b.id, keyword=f"dentist service {i} pune", day=date.today() - timedelta(days=d), rank=random.randint(1, 40),
                                  serp=[{"position": p, "url": f"https://r{p}.example/", "title": "Result " * 5} for p in range(1, 21)]))
    for i in range(25):
        db.add(Article(business_id=b.id, keyword=f"article keyword {i}", title=f"Article {i} for load business {n}", status="completed", body="<p>" + ("Lorem ipsum dolor sit amet. " * 700) + "</p>",
                       meta_description="A meta description for the article", headings=["H2 one", "H2 two"], stats={"total_seconds": 90, "seo_report": {"checks": [{"label": "x"}] * 30}}))
    kinds = ["gbp", "technical", "onpage", "rankings", "backlinks", "citations"]
    for i in range(15):
        k = kinds[i % 6]
        when = now - timedelta(days=i)
        db.add(Audit(business_id=b.id, kind=k, status="done", score=random.randint(40, 95), created_at=when, finished_at=when, data_source="live",
                     result={"pages": [{**p, "url": p["url"].format(n=n)} for p in PAGES]} if k == "onpage" else {"detail": "x" * 2000},
                     issues=[{"level": random.choice(["critical", "serious", "warning"]), "title": f"Issue {j}", "fix": "Fix it"} for j in range(random.randint(0, 8))]))
    for i in range(20):
        db.add(Review(business_id=b.id, rating=random.randint(1, 5), body="A review " * 10, reply_status=random.choice(["none", "draft", "posted"]), review_date=date.today() - timedelta(days=i)))
    for i in range(10):
        db.add(Lead(business_id=b.id, lead_date=date.today() - timedelta(days=i)))
    for d in range(60):
        db.add(InsightDay(business_id=b.id, day=date.today() - timedelta(days=d), calls=random.randint(0, 9), directions=random.randint(0, 9), website_clicks=random.randint(0, 9)))
    for job in ("full_audit", "rank_scan", "reviews", "posts", "report", "weekly_plan"):
        db.add(Schedule(business_id=b.id, job=job, every="weekly", next_run_at=now + timedelta(days=3)))
    for i in range(5):
        db.add(AgentTask(business_id=b.id, agent="gbp", kind="gbp_post", title=f"Task {i}", status="pending", requires_approval=True))
        db.add(Competitor(business_id=b.id, name=f"Rival {i}", website=f"https://rival{n}-{i}.example", selected=True))
    db.commit()
print(f"seeded {users} users with projects", flush=True)
db.close()
