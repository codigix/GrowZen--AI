"""Onboarding assistant: checks a new client's details against every source we can read, and fills the gaps.

Correctness comes from cross-checking, not from the AI: each field (name, phone, address, website,
category) is compared across Google Maps, the business's own website and what was typed, and marked
verified (two sources agree), conflict (they disagree: a person picks), only typed, or missing.
The AI (when configured) only writes what has no single right answer: the description, the best
category and the services list, always from the facts found and labelled as AI.
"""
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import ai, discovery, keywords
from . import countries
from .match import phone_digits, site_domain
from .profile_score import name_looks_stuffed

PIN_RE = re.compile(r"\b[1-9]\d{5}\b")
FIELDS = ["name", "phone", "address", "website", "primary_category"]
SOURCE_LABEL = {"form": "typed", "maps": "Google Maps", "website": "website"}
# Placeholder types Google Maps and schema.org use when they don't know the business's real category.
GENERIC = {"services", "service", "organization", "localbusiness", "local business", "corporation", "business", "point of interest",
           "establishment", "store", "company", "professional service", "professionalservice"}
NAME_SUFFIX = re.compile(r"\s[-–—|]\s(.{3,60})$")


def _category(v: Any) -> str:
    """A real category, or "" for placeholders like "Services" or "Organization"."""
    s = str(v or "").strip()
    return "" if s.lower() in GENERIC else s


def _norm(field: str, v: Any, country: str | None = None) -> str:
    """The comparable core of a value: the national number for phones, the postcode (where the country uses
    them) for addresses, the domain for websites."""
    s = str(v or "").strip()
    if not s:
        return ""
    if field == "phone":
        return countries.national(s, country) if countries.phone_ok(s, country) else ""
    if field == "address":
        rx = countries.postcode_re(country)
        m = rx.search(s) if rx else None
        return m.group(0).replace(" ", "").upper() if m else re.sub(r"[^a-z0-9]", "", s.lower())[:40]
    if field == "website":
        return site_domain(s).lower()
    words = re.findall(r"[a-z0-9]+", s.lower())
    return " ".join(w for w in words if w not in {"pvt", "ltd", "private", "limited", "the", "and", "llp"})


def _agree(field: str, a: str, b: str) -> bool:
    if not a or not b:
        return False
    if field in ("name", "primary_category"):
        return a == b or a in b or b in a  # "Sai Dental Care" matches "Sai Dental Care Aundh"
    return a == b


def verify(form: dict[str, Any], maps: dict[str, Any], site: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Per field: each source's value, the status, and the options when sources disagree."""
    values = {
        "name": {"form": form.get("name"), "maps": (maps.get("displayName") or {}).get("text"), "website": site.get("name")},
        "phone": {"form": form.get("phone"), "maps": discovery._norm_phone(maps.get("internationalPhoneNumber") or maps.get("nationalPhoneNumber"), form.get("country") or None), "website": site.get("phone")},
        "address": {"form": form.get("address"), "maps": discovery.clean_address(maps.get("formattedAddress")), "website": site.get("address")},
        "website": {"form": form.get("website"), "maps": maps.get("websiteUri"), "website": site.get("website")},
        "primary_category": {"form": _category(form.get("primary_category")), "maps": _category((maps.get("primaryTypeDisplayName") or {}).get("text")), "website": _category(site.get("schema_type"))},
    }
    # A site whose title is just its domain ("www.example.com") gives no business name.
    if re.fullmatch(r"(https?://)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+/?", str(values["name"]["website"] or "").strip().lower()):
        values["name"]["website"] = None
    out = {}
    for field, by in values.items():
        by = {k: v for k, v in by.items() if v}
        norm = {k: _norm(field, v, form.get("country")) for k, v in by.items()}
        groups: list[dict[str, Any]] = []  # sources that agree with each other
        for src, n in norm.items():
            if not n:
                continue
            g = next((g for g in groups if _agree(field, g["norm"], n)), None)
            if g:
                g["sources"].append(src)
            else:
                groups.append({"norm": n, "value": by[src], "sources": [src]})
        # The value to show for a group: Maps' text, then the website's, then typed; for names what was typed
        # first, since listing titles often carry extra words ("Name – keywords").
        order = ("form", "website", "maps") if field == "name" else ("maps", "website", "form")
        for g in groups:
            g["value"] = by[next(s for s in order if s in g["sources"])]
        groups.sort(key=lambda g: -len(g["sources"]))
        typed = norm.get("form", "")
        if not groups:
            status = "missing"
        elif len(groups) > 1:
            status = "conflict"
        elif not typed:
            status = "suggested"  # a source has it, the form doesn't yet
        elif len(groups[0]["sources"]) >= 2:
            status = "verified"
        else:
            status = "only_typed" if groups[0]["sources"] == ["form"] else "single_source"
        out[field] = {"status": status, "values": by,
                      "options": [{"value": g["value"], "sources": [SOURCE_LABEL[s] for s in g["sources"]]} for g in groups],
                      "best": groups[0]["value"] if groups else None}
    return out


def checks(form: dict[str, Any], maps: dict[str, Any], site: dict[str, Any] | None, website_given: bool) -> list[dict[str, str]]:
    out = []
    status = maps.get("businessStatus")
    if status in ("CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"):
        out.append({"level": "critical", "text": f"Google lists the business as {'permanently' if status == 'CLOSED_PERMANENTLY' else 'temporarily'} closed. Confirm with the client before onboarding."})
    if website_given and site is None:
        out.append({"level": "serious", "text": "The website didn't answer. Check the address is right and the site is online."})
    if site and site.get("javascript_only"):
        out.append({"level": "warning", "text": "The website shows its content only with JavaScript, so Google and AI search may see an empty page."})
    if form.get("name") and name_looks_stuffed(form["name"]):
        out.append({"level": "serious", "text": "The name looks keyword-stuffed (extra words like 'best', '|' or a location). Use the registered name: stuffed names get profiles suspended."})
    listed = (maps.get("displayName") or {}).get("text") or ""
    if listed and name_looks_stuffed(listed) and listed != form.get("name"):
        out.append({"level": "warning", "text": f"The Google listing's name is \"{listed}\": extra words after the business name count as keyword stuffing and can get the profile suspended. Rename it to the registered name."})
    c = form.get("country") or None
    if form.get("phone") and not countries.phone_ok(form["phone"], c):
        lengths = countries.info(c)["digits"]
        out.append({"level": "serious", "text": f"The phone number doesn't look complete for {countries.name(c)}" + (f" ({' or '.join(map(str, lengths))} digits after +{countries.info(c)['dial']})." if lengths else ".")})
    if form.get("address") and not countries.has_postcode(form["address"], c):
        out.append({"level": "warning", "text": f"The address has no {countries.postcode_name(c)}."})
    desc = form.get("description") or ""
    if re.search(r"https?://|www\.|\+?\d[\d\s-]{8,}", desc):
        out.append({"level": "warning", "text": "The description contains a link or phone number, which Google doesn't allow there."})
    if desc and len(desc) < 250:
        out.append({"level": "info", "text": f"The description is short ({len(desc)} characters). 600-750 characters help Google understand the business."})
    return out


def _keywords(form: dict[str, Any], category: str, services: list[str]) -> list[str]:
    """Real local searches from Google Autocomplete for the main category and services in the area."""
    area = (form.get("area") or "").split(",")[0].strip()
    city = (form.get("city") or "").strip()
    seeds = [s.lower() for s in [category, *services] if _category(s)][:3]
    queries = [q for s in seeds for q in (f"{s} in {area}" if area else None, f"{s} {city}" if city else None, f"{s} near me")][:9]
    queries = [q for q in queries if q]
    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = list(pool.map(lambda q: keywords.autocomplete(q, countries.gl(form.get("country"))), queries))
    places = set(re.findall(r"[a-z]+", f"{area} {city}".lower()))
    elsewhere = keywords.other_cities(places, countries.code(form.get("country")))  # searches in other cities aren't this client's customers
    found: list[str] = []
    for q, sug in zip(queries, answers):
        core = set(re.findall(r"[a-z]+", q)) - {"in", "near", "me"}
        for text, _ in sug[:4]:
            k = " ".join(text.lower().split())
            words = set(re.findall(r"[a-z]+", k))
            if k not in found and core & words and len(k.split()) <= 7 and not words & keywords.NOISE and not words & elsewhere:
                found.append(k)
    return found[:10]


def suggestions(form: dict[str, Any], maps: dict[str, Any], site: dict[str, Any]) -> dict[str, Any]:
    maps_category = _category((maps.get("primaryTypeDisplayName") or {}).get("text"))
    suffix = NAME_SUFFIX.search((maps.get("displayName") or {}).get("text") or "")
    typed_category = _category(form.get("primary_category"))
    category = typed_category or maps_category or (suffix.group(1).strip() if suffix else "")
    description = form.get("description") or site.get("description") or (maps.get("editorialSummary") or {}).get("text") or ""
    services = [s for s in form.get("services") or []]
    source = {"category": "typed" if typed_category else "Google Maps" if maps_category else "listing name" if category else "none",
              "description": "typed" if form.get("description") else "website" if site.get("description") else "Google Maps" if (maps.get("editorialSummary") or {}).get("text") else "none",
              "services": "typed"}
    name = form.get("name") or ""
    registered = NAME_SUFFIX.sub("", name).strip() if name_looks_stuffed(name) else name  # never repeat stuffed words in the text
    if len(description) < 250 and registered and category:
        where = ", ".join(x for x in [form.get("area"), form.get("city")] if x)
        description = (f"{registered} is a {category.lower()}{' in ' + where if where else ''}."
                       + (f" Services include {', '.join(services[:6])}." if services else "")
                       + (f" {description}" if description else "")).strip()
        # Only facts we have, until Google's useful length: where it is and whom it serves (no phone or links,
        # which Google doesn't allow in a description).
        address = discovery.clean_address(maps.get("formattedAddress")) or form.get("address") or site.get("address") or ""
        extra = [f" Visit us at {address}." if address else "",
                 f" Serving customers in {where} and nearby areas." if where else "",
                 f" Contact {registered} to ask about {category.lower()} services or to book a visit."]
        for sentence in extra:
            if len(description) >= 250:
                break
            description += sentence
        description = description.strip()[:750]
        source["description"] = "template"
    if ai.is_configured():
        try:
            facts = {"name": registered, "area": form.get("area"), "city": form.get("city"), "maps_category": category,
                     "maps_types": maps.get("types"), "maps_summary": (maps.get("editorialSummary") or {}).get("text"),
                     "website_description": site.get("description"), "website_headings": site.get("headings"), "services_typed": services}
            out = ai.complete_json(
                f"You prepare a new local business client's Google Business Profile.\n{ai.RULES}\n- Services must be things this business clearly offers according to the facts.",
                f"Facts: {facts}\n\nReturn JSON {{\"category\": \"the single best Google Business Profile primary category\", "
                "\"services\": [\"up to 10 services, short names\"], \"description\": \"600-750 characters: what they do, for whom, where; no links, phone numbers or promotions\"}.",
                temperature=0.3, max_tokens=900)
            if out.get("category"):
                category, source["category"] = str(out["category"])[:120], "AI"
            got = [str(s).strip()[:80] for s in out.get("services") or [] if str(s).strip()]
            if got:
                services, source["services"] = list(dict.fromkeys([*services, *got]))[:12], "AI"
            if len(str(out.get("description") or "")) >= 200:
                description, source["description"] = str(out["description"])[:750], "AI"
        except Exception:
            pass  # the rule-based suggestions stand
    loc = maps.get("location") or {}
    # A keyword-stuffed name ("Name – keywords"): offer the registered name, confirmed by the website when it agrees.
    clean = registered if registered != name else ""
    name_fix = {"value": clean, "source": "website" if site.get("name") and _norm("name", site["name"]) == _norm("name", clean) else "rules"} if clean and clean != name else None
    return {"name": name_fix, "category": {"value": category, "source": source["category"]},
            "description": {"value": description, "source": source["description"]},
            "services": {"values": services, "source": source["services"]},
            "keywords": {"values": _keywords(form, category, services), "source": "Google Autocomplete"},
            "hours": (maps.get("regularOpeningHours") or {}).get("weekdayDescriptions") or [],
            "pin": {"lat": loc.get("latitude"), "lng": loc.get("longitude")} if loc.get("latitude") is not None else None}


def assist(form: dict[str, Any], place_id: str | None = None, fresh: bool = False) -> dict[str, Any]:
    """Cross-check the form against Google Maps and the website, flag problems, and suggest what's missing."""
    maps: dict[str, Any] = {}
    matched = None
    if discovery.places_enabled():
        if place_id:
            try:
                maps, matched = discovery.place_details(place_id, fresh=fresh), "listing"
            except discovery.DiscoveryError:
                maps = {}
        elif form.get("name"):
            try:
                found = discovery._places_post(f"{form['name']} {form.get('city') or ''}".strip(), 3, form.get("country") or None)
            except discovery.DiscoveryError:
                found = []
            hit = next((p for p in found if _agree("name", _norm("name", form["name"]), _norm("name", (p.get("displayName") or {}).get("text")))), None)
            if hit:
                maps, matched = discovery.place_details(hit["id"], fresh=fresh), "search"
    form = {**form, "country": form.get("country") or countries.detect(maps.get("addressComponents"), maps.get("formattedAddress"), maps.get("internationalPhoneNumber") or form.get("phone")) or ""}
    domain = site_domain(form.get("website") or maps.get("websiteUri") or "")
    site = None
    if domain:
        try:
            site = discovery.read_website(domain)
        except Exception:
            site = None
    fields = verify(form, maps, site or {})
    verified = sum(1 for f in fields.values() if f["status"] == "verified")
    return {"ai": ai.is_configured(), "country": countries.code(form.get("country")), "maps": {"enabled": discovery.places_enabled(), "matched": matched, "url": maps.get("googleMapsUri"), "place_id": maps.get("id")},
            "website": {"read": bool(site), "domain": domain or None},
            "fields": fields, "verified": verified, "conflicts": sum(1 for f in fields.values() if f["status"] == "conflict"),
            "checks": checks(form, maps, site, bool(domain)),
            "suggestions": suggestions(form, maps, site or {})}
