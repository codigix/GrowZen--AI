"""What a project must have, by the services it uses. A project that does SEO only is not asked for a Google profile's details; a project with a Google profile is.

  SEO, GEO, AEO  need a website (their audits, keywords and AI questions are about it) and the services it sells.
  GMB            needs a phone, a city and a main category (the Google profile and every listing carry them).
  Local reach    (target scope "local") needs a city or target areas; international reach needs target countries.
Used when a project is created or its services change. Returns plain sentences, one per problem.
"""
from __future__ import annotations

from typing import Any

SEO_FAMILY = ("seo", "geo", "aeo")


def problems(d: dict[str, Any], modules: list[str] | None) -> list[str]:
    mods = list(modules or [])
    out: list[str] = []
    if not mods:
        return ["Choose at least one service for the project: SEO, AI search or the Google Business Profile."]
    if not str(d.get("name") or "").strip():
        out.append("The business name is required.")
    if any(m in mods for m in SEO_FAMILY):
        if not str(d.get("website") or "").strip():
            out.append("A website is required for SEO and AI search: the audits, keywords and AI questions are about it.")
        if not (d.get("services") or []):
            out.append("Add at least one service or product: keywords and pages are built from them.")
    if "gmb" in mods:
        if not str(d.get("phone") or "").strip():
            out.append("A phone number is required for the Google Business Profile.")
        if not str(d.get("city") or "").strip():
            out.append("The city is required for the Google Business Profile.")
        if not str(d.get("primary_category") or "").strip():
            out.append("The main category is required for the Google Business Profile.")
    scope = d.get("target_scope") or "local"
    if scope == "local" and not (str(d.get("city") or "").strip() or d.get("target_areas")):
        out.append("Local reach needs a city or at least one target area.")
    if scope == "international" and not d.get("target_countries"):
        out.append("International reach needs at least one target country.")
    return out
