"""Apify DA/PA/spam for the Backlink Checker: one lookup per linking site, saved as each run ends (Apify is stubbed: no network)."""
import time

from app.services import apify_metrics as am
from app.services import backlink_checker as bc

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_saved_apify_figures():
    """Saved Apify figures last 24 h by design: each test starts with none."""
    from app.backlinks.models import BiDomainMetric
    from app.db import SessionLocal
    def wipe():
        db = SessionLocal()
        try:
            db.query(BiDomainMetric).filter(BiDomainMetric.source == "apify").delete()
            db.commit()
        finally:
            db.close()
    wipe()
    yield
    wipe()


def _rows(srcs):
    return [{"source_url": u, "state": "working", "follow": "dofollow", "links": [], "checked_at": "2026-01-01T00:00:00+00:00"} for u in srcs]


def _wait(client, base):
    for _ in range(200):
        st = client.get(f"{base}/scores/status").json()
        if not st["running"]:
            return st
        time.sleep(0.05)
    raise AssertionError("lookup did not finish")


def _setup(client, monkeypatch, sources, rows):
    for name in ("google_configured", "dfs_configured", "opr_configured"):
        monkeypatch.setattr(bc, name, lambda: False)
    monkeypatch.setattr(am, "configured", lambda: True)
    monkeypatch.setattr(bc, "check_many", lambda srcs, target: (_rows(srcs), None))
    bid = client.post("/api/v1/businesses", json={"name": "Salon", "website": "https://salon.example"}).json()["id"]
    base = f"/api/v1/businesses/{bid}/backlink-check"
    assert client.post(base, json={"sources": sources}).status_code == 200
    return base


def test_each_site_is_looked_up_once_and_its_figures_reach_every_page(client, monkeypatch):
    calls = []
    monkeypatch.setattr(am, "lookup", lambda doms: calls.append(list(doms)) or [{"domain": d, "domain_authority": 10, "home_page_authority": 28, "spam_score": 4} for d in doms])
    base = _setup(client, monkeypatch, ["https://blog.example.com/a", "https://blog.example.com/b", "https://other.example.org/c"], None)
    assert client.get(base).json()["apify"] is True and client.get(base).json()["missing_scores"] == 3
    assert client.post(f"{base}/scores").json()["started"] is True  # answers at once
    st = _wait(client, base)
    assert sorted(d for c in calls for d in c) == ["example.com", "example.org"] and st["filled"] == 3 and st["failed"] == []
    got = client.get(base).json()
    assert all(r["scores"] == {"da": 10, "pa": 28, "spam": 4, "rd": None, "source": "Apify", "site_level": True} for r in got["rows"]) and got["missing_scores"] == 0


def test_a_site_apify_has_no_figures_for_is_reported_not_invented(client, monkeypatch):
    monkeypatch.setattr(am, "lookup", lambda doms: [])
    base = _setup(client, monkeypatch, ["https://down.example.net/a"], None)
    client.post(f"{base}/scores")
    st = _wait(client, base)
    assert st["filled"] == 0 and st["failed"] and "no figures" in st["failed"][0].lower()
    assert client.get(base).json()["rows"][0].get("scores") is None


def test_a_refused_token_stops_the_rest_with_the_reason(client, monkeypatch):
    def refuse(doms):
        raise am.ApifyError("Apify refused the token: check APIFY_KEY.")
    monkeypatch.setattr(am, "lookup", refuse)
    base = _setup(client, monkeypatch, [f"https://s{i}.example.com/p" for i in range(6)] and [f"https://s{i}.site{i}.com/p" for i in range(6)], None)
    client.post(f"{base}/scores")
    st = _wait(client, base)
    assert st["filled"] == 0 and len(st["failed"]) == 6 and all("token" in f for f in st["failed"])


def test_as_scores_reads_the_actor_fields():
    assert am.as_scores({"domain": "a.com", "domain_authority": "67", "home_page_authority": 54.0, "spam_score": 3}) == {"da": 67, "pa": 54, "spam": 3, "rd": None, "source": "Apify", "site_level": True}
    assert am.as_scores({"domain": "a.com"}) is None


def _fresh(monkeypatch, tokens):
    from types import SimpleNamespace
    st = SimpleNamespace(apify_key=tokens[0] if tokens else "", apify_cache_hours=24, **{f"apify_key_{n}": (tokens[n] if n < len(tokens) else "") for n in range(1, 11)})
    monkeypatch.setattr(am, "get_settings", lambda: st)
    am._cool.clear()


def test_keys_are_read_in_order_and_empty_ones_skipped(monkeypatch):
    _fresh(monkeypatch, ["", "t1", "", "t3"])
    assert am.keys() == [(1, "t1"), (3, "t3")]


def test_a_key_out_of_credit_switches_to_the_next_and_is_rested(monkeypatch):
    _fresh(monkeypatch, ["a", "b", "c"])
    used = []
    def run(token, doms):
        used.append(token)
        if token in ("a", "b"):
            raise am._Refused(402 if token == "a" else 403)
        return [{"domain": d, "domain_authority": 5, "home_page_authority": 6, "spam_score": 1} for d in doms]
    monkeypatch.setattr(am, "_run", run)
    assert am.lookup(["x.com"])[0]["domain"] == "x.com" and used == ["a", "b", "c"]
    used.clear()
    am.lookup(["y.com"])
    assert used == ["c"]  # a and b are left alone for a while


def test_every_key_refused_gives_one_clear_message_without_the_tokens(monkeypatch):
    _fresh(monkeypatch, ["secret-a", "secret-b"])
    monkeypatch.setattr(am, "_run", lambda token, doms: (_ for _ in ()).throw(am._Refused(402)))
    try:
        am.lookup(["x.com"])
        raise AssertionError("expected NoKeyLeft")
    except am.NoKeyLeft as e:
        assert "out of credit" in str(e) and "secret" not in str(e)
    got = am.check(["p.com", "q.com", "r.com", "s.com", "t.com"])
    assert len(got) == 5 and all("error" in r for r in got)


def test_other_failures_do_not_burn_through_the_keys(monkeypatch):
    _fresh(monkeypatch, ["a", "b"])
    used = []
    def run(token, doms):
        used.append(token)
        raise am.ApifyError("Apify answered 500.")
    monkeypatch.setattr(am, "_run", run)
    try:
        am.lookup(["x.com"])
    except am.ApifyError:
        pass
    assert used == ["a"] and am._cool == {}


def test_a_domain_is_not_asked_again_within_24_hours_and_is_after(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.backlinks.models import BiDomainMetric
    from app.db import SessionLocal
    _fresh(monkeypatch, ["a"])
    monkeypatch.setattr(am, "configured", lambda: True)
    asked = []
    monkeypatch.setattr(am, "lookup", lambda doms: asked.append(list(doms)) or [{"domain": d, "domain_authority": 20, "home_page_authority": 25, "spam_score": 2} for d in doms if d != "empty.example"])
    first = am.check(["cache1.example", "cache2.example", "empty.example"])
    assert sorted(d for a in asked for d in a) == ["cache1.example", "cache2.example", "empty.example"] and not any(r.get("cached") for r in first)
    asked.clear()
    again = am.check(["cache1.example", "cache2.example", "empty.example"])
    assert asked == [] and all(r["cached"] for r in again)  # nothing is paid for
    assert {r["domain"]: r["scores"]["da"] for r in again if r.get("scores")} == {"cache1.example": 20, "cache2.example": 20}
    assert [r["domain"] for r in again if "error" in r] == ["empty.example"]  # "no figures" is remembered too
    am.check(["cache1.example"], force=True)
    assert asked == [["cache1.example"]]  # force asks anyway
    db = SessionLocal()
    try:
        old = datetime.now(timezone.utc) - timedelta(hours=25)
        for m in db.query(BiDomainMetric).filter(BiDomainMetric.domain.in_(["cache1.example", "cache2.example"])):
            m.fetched_at = old
        db.commit()
    finally:
        db.close()
    asked.clear()
    am.check(["cache1.example", "cache2.example"])
    assert sorted(d for a in asked for d in a) == ["cache1.example", "cache2.example"]  # older than a day: asked again


def test_a_refused_key_or_network_failure_is_not_remembered(monkeypatch):
    _fresh(monkeypatch, ["a"])
    def refuse(doms):
        raise am.NoKeyLeft("No Apify key could be used (key 1: out of credit).")
    monkeypatch.setattr(am, "lookup", refuse)
    assert "error" in am.check(["fail1.example"])[0]
    assert am.cached(["fail1.example"]) == {}  # the next press tries again


def test_a_blank_apify_cache_hours_in_env_uses_the_default_instead_of_crashing(monkeypatch):
    from app.config import Settings
    monkeypatch.setenv("APIFY_CACHE_HOURS", "")
    assert Settings().apify_cache_hours == 24
    monkeypatch.setenv("APIFY_CACHE_HOURS", "12")
    assert Settings().apify_cache_hours == 12
