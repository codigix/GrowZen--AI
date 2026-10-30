"""Internal (our own) versus client businesses on the Domain Overview: what to check, and how much data to pull.

A business is internal when its website's domain is listed in INTERNAL_DOMAINS (the agency's own sites). The rest are clients.
The checks say what is missing for real data and who has to fix it: for our own site that is us, for a client it may be the client.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business
from . import gsc

PLACEHOLDER_HOSTS = {"example.com", "example.org", "example.net", "localhost", "test.com", "yourwebsite.com", "website.com"}

# What a Domain Overview may pull from the paid link/keyword index. Our own site gets the deeper, fresher set; clients a capped, cheaper one.
LIMITS = {
    "internal": {"keywords": 100, "competitors": 25, "backlinks": 100, "pages": 50, "cache_days": 1},
    "client": {"keywords": 25, "competitors": 10, "backlinks": 25, "pages": 20, "cache_days": 7},
}


def is_internal(business: Business) -> bool:
    host = gsc.host_of(business.website)
    return bool(host) and any(host == d or host.endswith("." + d) for d in get_settings().internal_domain_list)


def limits_for(internal: bool) -> dict:
    return LIMITS["internal" if internal else "client"]


def checks(db: Session, b: Business, internal: bool, traffic: dict) -> list[dict]:
    """[{id, level (error|warning|info), message}]; checks that don't apply to the kind of business are skipped."""
    s = get_settings()
    host = gsc.host_of(b.website)
    out: list[dict] = []

    def add(id: str, level: str, message: str) -> None:
        out.append({"id": id, "level": level, "message": message})

    if not host:
        add("website", "error", "This business has no website address. Add it in the business settings; every figure here is matched by domain.")
    elif host in PLACEHOLDER_HOSTS:
        add("website", "error", f"{host} is a placeholder, not a real website, so no traffic or link data can exist for it. Replace it with the real address.")
    else:
        twins = [o for o in db.scalars(select(Business).where(Business.id != b.id)) if gsc.host_of(o.website) == host]
        if twins:
            add("duplicate", "warning", f"This website is also onboarded as {', '.join(f'“{o.name}” (#{o.id})' for o in twins[:3])}. The numbers are the same for each; keep one so results are not counted twice.")

    # Google traffic (Search Console)
    state = traffic.get("state")
    if not s.google_oauth_enabled:
        add("google", "error", "Google sign-in is not set up on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env), so Search Console cannot be connected for anyone." if internal
            else "Google connection is not available yet. Ask an admin to finish the Google setup, then connect the client's Search Console.")
    elif state in ("not_connected", "scope_missing"):
        add("google", "warning", "Connect the agency's own Google account that owns this site in Search Console." if internal
            else "Connect a Google account that can see the client's site in Search Console: the client's own login, or the agency account the client has added as a user.")
    elif state == "no_property":
        add("google", "warning", traffic.get("message") or "The connected Google account has no verified Search Console property for this site.")
    elif state == "error":
        add("google", "error", traffic.get("message") or "Google did not return the traffic.")
    elif state == "ok" and not internal and b.connection_id is None:
        add("google", "info", f"Traffic is read through the agency account {traffic.get('account')}. The client has no Google connection of their own saved.")

    # Link and keyword index (DataForSEO)
    if s.domain_intel_mock_on:
        add("index", "info", "Authority, traffic, keywords, competitors, ads and backlinks are SAMPLE data (DOMAIN_INTEL_MOCK) for testing the page. They are not real.")
    elif not s.dataforseo_enabled:
        add("index", "warning" if internal else "info",
            "Authority, backlinks, competitors and estimated keywords need DataForSEO: add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to backend/.env and restart." if internal
            else "Authority, backlinks and competitor data are not switched on yet. An admin has to add the data provider.")

    # Client-only: an unapproved client should not be analysed yet
    if not internal and b.status == "needs_approval":
        add("approval", "warning", "This client is waiting for approval. Approve them before spending data credits on their domain.")
    return out
