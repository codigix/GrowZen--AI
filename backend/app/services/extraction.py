"""Pull a business out of an onboarding email.

The AI reads emails in any shape (a form, a forwarded chat, three typed lines). A rule-based
reader runs first and fills what it can, so the pipeline still works without AI, and the AI's
answer is checked against the email so nothing invented gets through.
"""
import re
from typing import Any

from . import ai

FIELDS = ["name", "website", "phone", "address", "area", "city", "category", "contact_name", "contact_email", "plan", "services"]
REQUIRED = ["name", "phone"]
PLANS = ["Starter", "Growth", "Pro", "Agency"]

URL_RE = re.compile(r"\b((?:https?://)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:in|com|co\.in|org|net|biz|info|io|co)(?:/[^\s,]*)?)", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+91[\s-]?)?(?:0)?([6-9]\d{4}[\s-]?\d{5})\b")
LABEL_RE = re.compile(r"^\s*(business(?: name)?|name|company|website|site|url|phone|mobile|contact number|address|location|category|contact person|contact|owner|package|plan|services?|main services)\s*[:\-]\s*(.+)$", re.I | re.M)
PINCODE_RE = re.compile(r"\b(\d{6})\b")
KNOWN_CITIES = ["Pune", "Mumbai", "Thane", "Nashik", "Nagpur", "Bengaluru", "Bangalore", "Hyderabad", "Delhi", "Chennai", "Ahmedabad"]


def _norm_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)[-10:]
    return f"+91 {digits[:5]} {digits[5:]}" if len(digits) == 10 else raw.strip()


def _norm_url(raw: str) -> str:
    u = raw.strip().rstrip(".,)")
    return u if u.lower().startswith("http") else f"https://{u}"


def rule_based(subject: str, body: str) -> dict[str, Any]:
    text = f"{subject}\n{body}"
    out: dict[str, Any] = {}
    for label, value in LABEL_RE.findall(body):
        key = label.lower()
        value = value.strip()
        if key in ("business", "business name", "name", "company"):
            out.setdefault("name", value)
        elif key in ("website", "site", "url"):
            out.setdefault("website", _norm_url(value) if value.lower() not in ("no", "none", "-", "na") else "")
        elif key in ("phone", "mobile", "contact number"):
            out.setdefault("phone", _norm_phone(value))
        elif key in ("address", "location"):
            out.setdefault("address", value)
        elif key == "category":
            out.setdefault("category", value)
        elif key in ("contact person", "contact", "owner"):
            out.setdefault("contact_name", value)
        elif key in ("package", "plan"):
            out.setdefault("plan", next((p for p in PLANS if p.lower() in value.lower()), value))
        elif key.startswith("service") or key == "main services":
            out.setdefault("services", [s.strip().capitalize() for s in re.split(r",|/| and ", value) if s.strip()])
    if "website" not in out:
        m = next((u for u in URL_RE.findall(body) if "@" not in u and not u.lower().endswith(("gmail.com", "codigixinfotech.com"))), None)
        if m:
            out["website"] = _norm_url(m)
        elif re.search(r"no website", text, re.I):
            out["website"] = ""
    if "phone" not in out:
        m = PHONE_RE.search(text)
        if m:
            out["phone"] = _norm_phone(m.group(0))
    if "plan" not in out:
        out["plan"] = next((p for p in PLANS if re.search(rf"\b{p}\b", text, re.I)), None)
    if "name" not in out:
        m = re.search(r"(?:onboard(?:ing)?|new client|start seo)\s*[:\-]?\s*([A-Z][\w&' .]+?)(?:\s*[\(\-,]|$)", subject, re.I)
        if m:
            out["name"] = m.group(1).strip()
    city = next((c for c in KNOWN_CITIES if re.search(rf"\b{c}\b", text, re.I)), None)
    if city:
        out["city"] = city
    return {k: v for k, v in out.items() if v not in (None, [])}


def extract(subject: str, body: str) -> tuple[dict[str, Any], list[str], str]:
    """Returns (fields, missing required fields, method)."""
    fields = rule_based(subject, body)
    method = "rules"
    if ai.is_configured():
        try:
            got = ai.complete_json(
                "You extract new-client details from onboarding emails for an SEO agency. Return JSON only. Use null for anything not in the email; never guess.",
                f"Email subject: {subject}\n\nEmail body:\n{body}\n\nReturn JSON with keys: name (business name), website, phone, address, area (locality), city, category (Google Business Profile category), contact_name, contact_email, plan (Starter|Growth|Pro|Agency or null), services (list of strings).",
                temperature=0, max_tokens=600,
            )
            # Keep an AI value only if it is grounded in the email text.
            low = f"{subject}\n{body}".lower()
            for k in FIELDS:
                v = got.get(k)
                if v in (None, "", []):
                    continue
                if k == "phone":
                    if re.sub(r"\D", "", str(v))[-10:] in re.sub(r"\D", "", low):
                        fields[k] = _norm_phone(str(v))
                elif k == "services":
                    fields[k] = [str(s).strip() for s in v if str(s).strip()][:12]
                elif k in ("category", "plan", "area", "city"):
                    fields[k] = str(v).strip()
                elif str(v).lower().replace("https://", "").replace("www.", "").split("/")[0] in low or str(v).lower() in low:
                    fields[k] = _norm_url(str(v)) if k == "website" else str(v).strip()
            method = "ai"
        except Exception:  # AI down or bad JSON: the rule-based result stands
            pass
    if fields.get("address") and not fields.get("area"):
        parts = [p.strip() for p in fields["address"].split(",") if p.strip()]
        locality = [p for p in parts if not PINCODE_RE.search(p) and p.lower() not in [c.lower() for c in KNOWN_CITIES]]
        if locality:
            fields["area"] = locality[-1]
    missing = [k for k in REQUIRED if not fields.get(k)]
    return fields, missing, method
