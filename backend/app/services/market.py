"""A project's market: who its customers are, which decides how it is searched and tracked.

  local          customers near the business: searches name the area and city, rankings are tracked street by street
                 (the Maps grid), the Google profile and local citations matter most.
  national       customers anywhere in the business's country: searches don't name a city, Google is read for the whole
                 country, rankings are tracked country-wide, the Maps grid does not apply.
  international  customers in other countries: Google is read per target country, keywords carry the country,
                 rankings are tracked per country.

`target_scope` is saved on the business (null means local, what every project was before this existed).
"""
from typing import Any

from . import countries

SCOPES = ("local", "national", "international")


def scope(b: Any) -> str:
    s = getattr(b, "target_scope", None)
    return s if s in SCOPES else "local"


def target_countries(b: Any) -> list[str]:
    """The countries searches are read for: the target countries (international), else the business's own."""
    if scope(b) == "international":
        picked = [countries.code(c) for c in (getattr(b, "target_countries", None) or []) if c]
        if picked:
            return list(dict.fromkeys(picked))
    return [countries.of(b)]


def serp_country(b: Any) -> str:
    """The country Google is asked as: the first target country for an international project."""
    return target_countries(b)[0]


def search_location(b: Any) -> str:
    """Where Serper searches from: a city for a local project, a whole country otherwise."""
    if scope(b) == "local":
        return countries.search_location(getattr(b, "city", None), countries.of(b))
    return countries.name(serp_country(b))


def places(b: Any) -> list[str]:
    """Place names keyword searches are built around: areas for a local project, country names otherwise."""
    if scope(b) == "local":
        return [x for x in [(getattr(b, "area", None) or "").split(",")[0].strip(), (getattr(b, "city", None) or "").strip()] if x]
    return [countries.name(c) for c in target_countries(b)][:4]


def label(b: Any) -> str:
    s = scope(b)
    if s == "local":
        where = ", ".join(x for x in [(getattr(b, "area", None) or "").split(",")[0].strip(), (getattr(b, "city", None) or "").strip()] if x)
        return f"Local · {where}" if where else "Local"
    if s == "national":
        return f"National · {countries.name(countries.of(b))}"
    return "International · " + (", ".join(countries.name(c) for c in target_countries(b)[:3]) + ("…" if len(target_countries(b)) > 3 else ""))


def summary(b: Any) -> dict[str, Any]:
    return {"scope": scope(b), "label": label(b), "countries": target_countries(b), "location": search_location(b), "geo_grid": scope(b) == "local"}
