"""A more exact business category than Google's Places API gives.

The Places API names a business by a broad type: a PG or co-living house is "Lodging", a gym can be "Point of interest", a shop "Store". Google Maps itself shows the owner's own,
more exact category, which the Places API does not pass on. This reads the business's name and Google's type list, and only when Google's label is one of the broad ones,
to suggest the exact one. It never replaces a specific label (Hotel, Dentist, Restaurant stay as Google gave them), and the person can always change it.
"""
import re
from typing import Any

# Labels the Places API uses when it cannot say what the business is.
BROAD = {"lodging", "establishment", "service", "services", "point of interest", "store", "health", "food", "finance", "place of worship", "local business", "business", "corporate office", "building", "office"}

# (pattern on the business name, exact category). The first that fits wins.
RULES: list[tuple[re.Pattern[str], str]] = [(re.compile(re.sub(r"\)\\b$", r")s?\\b", p), re.I), label) for p, label in [  # a trailing s is allowed: "Hotels", "Salons"
    (r"\b(pg|p\.g\.|paying[- ]guests?|co[- ]?living|coliving|ladies pg|girls pg|boys pg|men'?s pg|women'?s pg|working (men|women|professionals)'?s? (pg|hostel))\b", "Paying guest accommodation"),
    (r"\b(hostel|dormitor(y|ies)|student (housing|accommodation))\b", "Hostel"),
    (r"\b(service[d]? apartments?|furnished apartments?|stay apartments?)\b", "Serviced apartment"),
    (r"\b(guest ?house|homestay|home stay|bed and breakfast|b&b)\b", "Guest house"),
    (r"\b(resort)\b", "Resort"),
    (r"\b(hotel|lodge|inn)\b", "Hotel"),
    (r"\b(beauty (parlou?r|salon|studio)|makeup studio|unisex salon|hair salon|salon)\b", "Beauty salon"),
    (r"\b(spa|massage)\b", "Spa"),
    (r"\b(gym|fitness (centre|center|club|studio)|crossfit)\b", "Gym"),
    (r"\b(yoga|zumba|pilates)\b", "Yoga studio"),
    (r"\b(dental|dentist|orthodontic)\b", "Dental clinic"),
    (r"\b(hospital)\b", "Hospital"),
    (r"\b(clinic|polyclinic|physiotherapy)\b", "Clinic"),
    (r"\b(coaching|classes|tutorials?|academy|institute)\b", "Educational institution"),
    (r"\b(restaurant|dhaba|biryani)\b", "Restaurant"),
    (r"\b(caf[eé]|coffee)\b", "Cafe"),
    (r"\b(digital marketing|seo|marketing agency|advertising agency)\b", "Marketing agency"),
    (r"\b(software|web (design|development)|it (company|services|solutions)|infotech|technolog(y|ies))\b", "Software company"),
]]

# What customers type for a category, so competitor searches use the words people use ("PG in Marunji", not "paying guest accommodation in Marunji").
SEARCH_TERMS = {
    "paying guest accommodation": ["PG", "paying guest", "co-living"],
    "serviced accommodation": ["serviced apartments"],
    "hostel": ["hostel"],
    "serviced apartment": ["serviced apartments"],
    "guest house": ["guest house"],
    "beauty salon": ["beauty salon", "salon"],
    "dental clinic": ["dentist", "dental clinic"],
    "clinic": ["clinic"],
    "gym": ["gym"],
    "yoga studio": ["yoga classes"],
    "marketing agency": ["digital marketing agency"],
    "software company": ["software company"],
    "educational institution": ["coaching classes"],
}


_RENT_NAME = re.compile(r"\b(rent|rental|rentals|rented|on rent|for rent|hire|hiring)\b", re.I)
_RENT_TEXT = re.compile(r"\brentals?\b|\bon rent\b|\bto rent\b|\bfor rent\b", re.I)
_CLOTHING = re.compile(r"\b(clothes|clothing|couture|fashion|wear|outfits?|garments?|lehengas?|lehnga|sarees?|saris?|gowns?|sherwanis?|dress(?:es)?|costumes?|suits?|ethnic|bridal)\b", re.I)
_ITEMS = [("lehenga", r"\blehengas?\b|\blehnga\b"), ("saree", r"\bsarees?\b|\bsaris?\b"), ("gown", r"\bgowns?\b"), ("sherwani", r"\bsherwanis?\b"), ("costume", r"\bcostumes?\b"),
          ("dress", r"\bdress(?:es)?\b"), ("suit", r"\bsuits?\b")]


def rental_seeds(name: str | None, category: str | None, services: list[str] | None, description: str | None) -> list[str]:
    """The searches customers type to find a RENTAL business ("lehenga on rent"), or [] when the business is not one. A rental business is a different business from the shop that sells the
    same goods: Google files a clothes rental as "Clothes market", and searching that finds every clothing shop in the area, none of them a competitor.
    It counts as a rental when its name, category or a service says so, or its description speaks of rental more than once (one "rent" in a description is not enough: a PG mentions rent)."""
    svc = [s for s in (services or []) if s]
    head = " ".join([name or "", category or "", *svc])
    desc = description or ""
    if not (_RENT_NAME.search(head) or len(_RENT_TEXT.findall(desc)) >= 2):
        return []
    text = f"{head} {desc}".lower()
    if _CLOTHING.search(text):
        items = [label for label, rx in _ITEMS if re.search(rx, text)]
        out = [f"{i} on rent" for i in items[:2]]
        out.append("designer clothes rental" if "designer" in text else "clothes on rent")
        return list(dict.fromkeys(out))[:3]
    plain = re.compile(r"\b(?:agency|agencies|service|services|company|shop|store|dealer|provider|centre|center)\b", re.I)

    def kind(text: str) -> str:
        return " ".join(plain.sub("", _RENT_NAME.sub("", text.lower())).split())

    noun = kind(category or "") if (category or "").strip().lower() not in BROAD else ""
    if not noun and svc:
        noun = kind(str(svc[0]))
    return [f"{noun} on rent", f"{noun} rental"] if noun else []


def refine(label: str | None, types: list[str] | None = None, name: str | None = None) -> tuple[str | None, bool]:
    """(category, refined). Only a broad Google label is refined; a specific one is returned as it is."""
    label = (label or "").strip() or None
    if label and label.lower() not in BROAD:
        return label, False
    text = (name or "").strip()
    for rx, exact in RULES:
        if rx.search(text):
            return exact, True
    return label, False


def search_terms(category: str | None) -> list[str]:
    """The phrases customers type for this category, or the category itself in lower case."""
    low = " ".join((category or "").lower().split())
    return SEARCH_TERMS.get(low) or ([low] if low else [])


def customer_terms(category: str | None, name: str | None = None) -> list[str]:
    """What customers type to find this business. Its own name says it better than a broad Google label: "Luxury PG | Co-living Space" is searched as "PG" and "co-living",
    while Google files it as "Serviced Accommodation". The name's words come first, then the category's."""
    out: list[str] = []
    named = next((label for rx, label in RULES if rx.search(name or "")), None)
    for term in [*search_terms(named), *search_terms(category)]:
        if term.lower() not in [x.lower() for x in out]:
            out.append(term)
    return out


def same_kind(a: str | None, b: str | None) -> bool:
    """Whether two category labels name the same kind of business (a loose match: one contains the other)."""
    x, y = " ".join((a or "").lower().split()), " ".join((b or "").lower().split())
    return bool(x and y and (x == y or x in y or y in x))


_NOT_A_PLACE = re.compile(r"^(phase|sector|block|wing|plot|gate|lane|zone|building|tower|floor|survey|gat|sr|s\.?no)\b|\d", re.I)


def usable_area(name: str | None) -> str | None:
    """A neighbourhood name people search with. Google sometimes names a plot, phase or sector ("Phase 1", "Sector 12"): that is not a place customers type, so it is dropped."""
    n = " ".join((name or "").split())
    return None if not n or _NOT_A_PLACE.search(n) else n
