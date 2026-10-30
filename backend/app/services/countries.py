"""Countries a business can be in: how Google is searched there, how its phones and addresses look, and which
listing sites matter there. Every business has a `country` (ISO 3166 alpha-2, e.g. "IN", "OM", "AE", "US"),
detected from its Google Maps listing, phone or address and editable; data without one is treated as India,
which is what the platform assumed before countries existed.

A country missing from COUNTRIES still works: Google is searched for it by its code, phones are compared by
their last digits, no postcode is required, and the international listing sites are checked.
"""
import re
from typing import Any

DEFAULT = "IN"

# Listing sites that matter almost everywhere.
INTERNATIONAL = [("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com"), ("Bing Places", "bing.com"),
                 ("Apple Maps", "apple.com"), ("Yelp", "yelp.com"), ("Foursquare", "foursquare.com"), ("Tripadvisor", "tripadvisor.com")]

# code: name, dial code, local number length(s), postcode pattern (None = no postcodes), Google language, listing sites.
COUNTRIES: dict[str, dict[str, Any]] = {
    "IN": {"name": "India", "dial": "91", "digits": (10,), "postcode": r"\b[1-9]\d{5}\b", "postcode_name": "PIN code", "hl": "en",
           "sites": [("Justdial", "justdial.com"), ("Sulekha", "sulekha.com"), ("IndiaMART", "indiamart.com"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "OM": {"name": "Oman", "dial": "968", "digits": (8,), "postcode": None, "hl": "en",
           "sites": [("Yellow Pages Oman", "yellowpages.com.om"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com"), ("Tripadvisor", "tripadvisor.com")]},
    "AE": {"name": "United Arab Emirates", "dial": "971", "digits": (9, 8), "postcode": None, "hl": "en",
           "sites": [("Yellow Pages UAE", "yellowpages-uae.com"), ("Connect.ae", "connect.ae"), ("Dubizzle", "dubizzle.com"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "SA": {"name": "Saudi Arabia", "dial": "966", "digits": (9,), "postcode": r"\b\d{5}\b", "postcode_name": "postal code", "hl": "en",
           "sites": [("Daleeli", "daleeli.com"), ("Yellow Pages KSA", "yellowpages.com.sa"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "QA": {"name": "Qatar", "dial": "974", "digits": (8,), "postcode": None, "hl": "en",
           "sites": [("Qatar Yellow Pages", "qatcom.com"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "KW": {"name": "Kuwait", "dial": "965", "digits": (8,), "postcode": r"\b\d{5}\b", "postcode_name": "postal code", "hl": "en",
           "sites": [("Yellow Pages Kuwait", "yellowpages.com.kw"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "BH": {"name": "Bahrain", "dial": "973", "digits": (8,), "postcode": None, "hl": "en",
           "sites": [("Bahrain Yellow Pages", "bahrainyellowpages.com"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "US": {"name": "United States", "dial": "1", "digits": (10,), "postcode": r"\b\d{5}(?:-\d{4})?\b", "postcode_name": "ZIP code", "hl": "en",
           "sites": [("Yelp", "yelp.com"), ("Better Business Bureau", "bbb.org"), ("Yellow Pages", "yellowpages.com"), ("Angi", "angi.com"), ("Facebook", "facebook.com"), ("Apple Maps", "apple.com"), ("Bing Places", "bing.com")]},
    "CA": {"name": "Canada", "dial": "1", "digits": (10,), "postcode": r"\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b", "postcode_name": "postal code", "hl": "en",
           "sites": [("Yelp", "yelp.ca"), ("Yellow Pages", "yellowpages.ca"), ("Better Business Bureau", "bbb.org"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "GB": {"name": "United Kingdom", "dial": "44", "digits": (10,), "postcode": r"\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b", "postcode_name": "postcode", "hl": "en",
           "sites": [("Yell", "yell.com"), ("Thomson Local", "thomsonlocal.com"), ("Trustpilot", "trustpilot.com"), ("Yelp", "yelp.co.uk"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "IE": {"name": "Ireland", "dial": "353", "digits": (9,), "postcode": r"\b[A-Z]\d{2} ?[A-Z\d]{4}\b", "postcode_name": "Eircode", "hl": "en",
           "sites": [("Golden Pages", "goldenpages.ie"), ("Yelp", "yelp.ie"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "AU": {"name": "Australia", "dial": "61", "digits": (9,), "postcode": r"\b\d{4}\b", "postcode_name": "postcode", "hl": "en",
           "sites": [("Yellow Pages", "yellowpages.com.au"), ("True Local", "truelocal.com.au"), ("Hotfrog", "hotfrog.com.au"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "NZ": {"name": "New Zealand", "dial": "64", "digits": (8, 9), "postcode": r"\b\d{4}\b", "postcode_name": "postcode", "hl": "en",
           "sites": [("Yellow", "yellow.co.nz"), ("Finda", "finda.co.nz"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "DE": {"name": "Germany", "dial": "49", "digits": (10, 11), "postcode": r"\d{5}", "postcode_name": "postcode", "hl": "de",
           "sites": [("Gelbe Seiten", "gelbeseiten.de"), ("Das Örtliche", "dasoertliche.de"), ("Yelp", "yelp.de"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "SG": {"name": "Singapore", "dial": "65", "digits": (8,), "postcode": r"\b\d{6}\b", "postcode_name": "postal code", "hl": "en",
           "sites": [("Yellow Pages SG", "yellowpages.com.sg"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "MY": {"name": "Malaysia", "dial": "60", "digits": (9, 10), "postcode": r"\b\d{5}\b", "postcode_name": "postcode", "hl": "en",
           "sites": [("Yellow Pages MY", "yellowpages.my"), ("Facebook", "facebook.com"), ("Instagram", "instagram.com"), ("LinkedIn", "linkedin.com")]},
    "ZA": {"name": "South Africa", "dial": "27", "digits": (9,), "postcode": r"\b\d{4}\b", "postcode_name": "postal code", "hl": "en",
           "sites": [("Brabys", "brabys.com"), ("Snupit", "snupit.co.za"), ("Facebook", "facebook.com"), ("Bing Places", "bing.com")]},
    "NP": {"name": "Nepal", "dial": "977", "digits": (10, 9), "postcode": r"\b\d{5}\b", "postcode_name": "postal code", "hl": "en", "sites": INTERNATIONAL[:4]},
    "LK": {"name": "Sri Lanka", "dial": "94", "digits": (9,), "postcode": r"\b\d{5}\b", "postcode_name": "postal code", "hl": "en", "sites": INTERNATIONAL[:4]},
    "BD": {"name": "Bangladesh", "dial": "880", "digits": (10,), "postcode": r"\b\d{4}\b", "postcode_name": "postal code", "hl": "en", "sites": INTERNATIONAL[:4]},
}

# Category-specific sites, per country (on top of the country's general ones).
CATEGORY_SITES: dict[str, dict[str, list[tuple[str, str]]]] = {
    "IN": {
        "health": [("Practo", "practo.com"), ("Lybrate", "lybrate.com"), ("Apollo 24|7", "apollo247.com")],
        "food": [("Zomato", "zomato.com"), ("Swiggy", "swiggy.com"), ("Tripadvisor", "tripadvisor.in")],
        "beauty": [("Urban Company", "urbancompany.com"), ("Magicpin", "magicpin.in")],
        "property": [("MagicBricks", "magicbricks.com"), ("99acres", "99acres.com"), ("Housing.com", "housing.com")],
        "education": [("Shiksha", "shiksha.com"), ("UrbanPro", "urbanpro.com")],
        "b2b_services": [("Clutch", "clutch.co"), ("GoodFirms", "goodfirms.co")],
        "trade": [("TradeIndia", "tradeindia.com"), ("ExportersIndia", "exportersindia.com")],
    },
    "*": {
        "health": [("Doctoralia", "doctoralia.com"), ("Healthgrades", "healthgrades.com")],
        "food": [("Tripadvisor", "tripadvisor.com"), ("Zomato", "zomato.com"), ("Talabat", "talabat.com")],
        "beauty": [("Fresha", "fresha.com"), ("Booksy", "booksy.com")],
        "property": [("Bayut", "bayut.com"), ("Property Finder", "propertyfinder.ae")],
        "education": [("Edarabia", "edarabia.com")],
        "b2b_services": [("Clutch", "clutch.co"), ("GoodFirms", "goodfirms.co")],
        "trade": [("Alibaba", "alibaba.com"), ("Kompass", "kompass.com")],
    },
}
_KINDS = (("health", r"doctor|dent|clinic|hospital|derma|physio|health|medical|eye|skin|ortho|pediatr|gyn"),
          ("food", r"restaurant|cafe|bakery|food|bar|hotel|caterer|sweet"), ("beauty", r"salon|spa|beauty|gym|fitness|yoga|barber"),
          ("property", r"real estate|property|builder|interior|architect"), ("education", r"school|coaching|tuition|academy|institute|college|nursery|preschool|kindergarten"),
          ("b2b_services", r"software|agency|marketing|digital|consult"), ("trade", r"manufactur|supplier|wholesale|exporter|industr|trading"))
_BY_NAME = {v["name"].lower(): k for k, v in COUNTRIES.items()} | {"uae": "AE", "u.a.e.": "AE", "usa": "US", "united states of america": "US", "uk": "GB", "england": "GB",
                                                                  "scotland": "GB", "wales": "GB", "ksa": "SA", "sultanate of oman": "OM"}


def code(c: str | None) -> str:
    """A valid country code, India when unknown."""
    c = (c or "").strip().upper()
    return c if re.fullmatch(r"[A-Z]{2}", c) else DEFAULT


def info(c: str | None) -> dict[str, Any]:
    k = code(c)
    return COUNTRIES.get(k) or {"name": k, "dial": "", "digits": (), "postcode": None, "hl": "en", "sites": INTERNATIONAL[:6]}


def of(b: Any) -> str:
    """The business's country code (India for businesses saved before countries were tracked)."""
    return code(getattr(b, "country", None))


def name(c: str | None) -> str:
    return info(c)["name"]


def gl(c: str | None) -> str:
    """Google's country parameter."""
    return code(c).lower()


def detect(address_components: list[dict[str, Any]] | None = None, address: str | None = None, phone: str | None = None) -> str | None:
    """The country from Google Maps' address parts, else the last part of an address, else the phone's dial code."""
    for part in address_components or []:
        if "country" in (part.get("types") or []):
            c = (part.get("shortText") or part.get("short_name") or "").upper()
            if re.fullmatch(r"[A-Z]{2}", c):
                return c
    if address:
        last = re.sub(r"[\d\-]+", "", address.split(",")[-1]).strip().lower()
        if last in _BY_NAME:
            return _BY_NAME[last]
    digits = re.sub(r"\D", "", phone or "")
    if (phone or "").strip().startswith(("+", "00")):
        digits = digits.removeprefix("00")
        for k, v in sorted(COUNTRIES.items(), key=lambda kv: -len(kv[1]["dial"])):
            if v["dial"] and digits.startswith(v["dial"]) and len(digits) - len(v["dial"]) in v["digits"]:
                return k
    return None


def national(phone: str | None, c: str | None = None) -> str:
    """A phone's national number (digits, without the country's dial code or a leading trunk 0)."""
    raw = (phone or "").strip()
    digits = re.sub(r"\D", "", raw)
    international = raw.startswith(("+", "00"))  # then a country code is certainly there
    if raw.startswith("00"):
        digits = digits[2:]
    dial = info(c)["dial"]
    lengths = info(c)["digits"] or ()
    if dial and digits.startswith(dial) and (international or not lengths or len(digits) - len(dial) in lengths):
        digits = digits[len(dial):]
    elif not dial and (phone or "").strip().startswith("+"):
        # Unknown country: strip any listed dial code that leaves a sensible length.
        for v in sorted(COUNTRIES.values(), key=lambda v: -len(v["dial"])):
            if digits.startswith(v["dial"]) and len(digits) - len(v["dial"]) in v["digits"]:
                digits = digits[len(v["dial"]):]
                break
    if digits.startswith("0") and lengths and len(digits) - 1 in lengths:
        digits = digits[1:]
    return digits


def phone_ok(phone: str | None, c: str | None) -> bool:
    """Whether a phone has a normal length for the country (any 7-12 digits when the country isn't listed)."""
    n = national(phone, c)
    lengths = info(c)["digits"]
    return len(n) in lengths if lengths else 7 <= len(n) <= 12


def same_phone(a: str | None, b: str | None, c: str | None = None) -> bool:
    """The same phone number, however written ("+968 9123 4567" = "91234567"; "+91 98220 11223" = "098220 11223")."""
    x, y = national(a, c), national(b, c)
    if len(x) < 7 or len(y) < 7:
        return False
    return x == y or (min(len(x), len(y)) >= 8 and (x.endswith(y) or y.endswith(x)))


def format_phone(phone: str | None, c: str | None) -> str | None:
    """"+968 9123 4567" style: the dial code, then the national number."""
    if not phone:
        return None
    n = national(phone, c)
    dial = info(c)["dial"]
    if not dial or not phone_ok(phone, c):
        return phone.strip()
    if code(c) == "IN" and len(n) == 10:
        return f"+91 {n[:5]} {n[5:]}"
    half = len(n) // 2
    return f"+{dial} {n[:half]} {n[half:]}"


def postcode_re(c: str | None) -> re.Pattern[str] | None:
    p = info(c).get("postcode")
    return re.compile(p, re.I) if p else None


def postcode_name(c: str | None) -> str:
    return info(c).get("postcode_name", "postcode")


def has_postcode(address: str | None, c: str | None) -> bool:
    """Whether the address has the country's postcode (always true where postcodes aren't used)."""
    rx = postcode_re(c)
    return True if rx is None else bool(rx.search(address or ""))


def listing_sites(category: str | None, c: str | None) -> list[tuple[str, str]]:
    """The listing sites that matter for this kind of business in this country, most important first."""
    k = code(c)
    cat = (category or "").lower()
    kind = next((kd for kd, pattern in _KINDS if re.search(pattern, cat)), None)
    extra = (CATEGORY_SITES.get(k) or CATEGORY_SITES["*"]).get(kind, []) if kind else []
    seen, out = set(), []
    for name_, domain in [*extra, *info(k)["sites"]]:
        if domain not in seen:
            seen.add(domain)
            out.append((name_, domain))
    return out[:7]


def search_location(city: str | None, c: str | None) -> str:
    """Serper's location for a city: "Pune, India", "Muscat, Oman"."""
    return ", ".join(x for x in [(city or "").strip(), name(c)] if x)


def all_countries() -> list[dict[str, str]]:
    """For the country pickers: the listed countries (others can still be typed as a 2-letter code)."""
    return [{"code": k, "name": v["name"], "dial": v["dial"]} for k, v in sorted(COUNTRIES.items(), key=lambda kv: kv[1]["name"])]
