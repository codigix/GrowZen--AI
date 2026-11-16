"""Page X-Ray: one page, read the way the SEO / AEO / GEO browser extensions read it, from real fetched data only.

Everything here comes from fetching the page and the files around it (robots.txt, llms.txt, the TLS certificate, RDAP). A value that cannot be
determined is None and a note says why: nothing is guessed. All fetching goes through the SSRF-safe client (services/net.site_client):
public http(s) addresses only, every redirect hop re-validated, 12 s per request, 2 MB of body at most.
"""
import json
import os
import re
import shutil
import socket
import ssl
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Callable
from urllib import robotparser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

from . import site_stack, tech_detect
from .crawler import _root
from .net import site_client
from .url_safety import SSRFValidationError, resolve_and_validate, validate_url_shape

MAX_REDIRECTS = 5
MAX_BYTES = 2 * 1024 * 1024
FETCH_TIMEOUT = 12
CHROME_TIMEOUT = 20  # hard limit for the first render attempt (seconds); the process tree is killed after it
CHROME_RETRY_TIMEOUT = 35  # the second, lighter attempt (a shorter virtual-time budget) when the first one timed out: Chrome's start-up and a slow third-party file vary a lot between runs
CHROME_MAX_BYTES = 3 * 1024 * 1024  # the rendered DOM is read up to here
CHROME_BUDGET_MS = 8000  # how much page time Chrome lets scripts run before it dumps the DOM
OWN_SITE_ONLY = "Render mode is only available for the project's own website."
# Chrome has its own network stack (it does not go through our SSRF-safe client), so names that point inside the machine or the cloud are made unresolvable for it.
CHROME_BLOCKED_HOSTS = ("localhost", "127.0.0.1", "169.254.169.254", "metadata.google.internal")
AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"]
MAIN_AI_BOTS = AI_BOTS[:5]  # the GEO check passes when none of these is blocked
QUESTION_WORDS = ("who", "what", "why", "how", "when", "where", "can", "does", "is", "are", "should", "do")
ORG_TYPES = {"organization", "corporation", "localbusiness", "person", "onlinestore", "store", "ngo", "educationalorganization", "governmentorganization", "newsmediaorganization"}


class XrayError(Exception):
    """A request the X-Ray cannot answer: status is the HTTP code to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


@dataclass
class Fetched:
    url: str
    final_url: str
    status: int
    headers: dict[str, str]
    html: str
    size_bytes: int
    redirects: list[dict[str, Any]] = field(default_factory=list)
    elapsed_ms: int = 0
    truncated: bool = False
    cookies: set[str] = field(default_factory=set)


# ----------------------------------------------------------------------------------------------------------------- fetching
def normalise_url(raw: str) -> str:
    """A tidy absolute http(s) URL: scheme added when missing, fragment dropped, host lower-cased."""
    raw = (raw or "").strip()
    if not raw:
        raise XrayError(422, "Enter the address of a page.")
    if "://" not in raw:
        if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", raw, re.I):  # javascript:, data:, mailto: ... are refused, never turned into a web address ("host:8080" is fine)
            raise XrayError(422, "Only http:// and https:// addresses can be checked.")
        raw = f"https://{raw}"
    try:
        validate_url_shape(raw)
    except SSRFValidationError as exc:
        raise XrayError(422, str(exc)) from exc
    p = urlsplit(raw)
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or "/", p.query, ""))


def assert_public(url: str) -> None:
    """Resolve the host and refuse anything that is not a public address (loopback, private, link-local, metadata...)."""
    try:
        resolve_and_validate(url)
    except SSRFValidationError as exc:
        raise XrayError(422, str(exc)) from exc


def fetch_page(url: str) -> Fetched:
    """GET the page, following up to MAX_REDIRECTS hops by hand so the chain is recorded; the body is capped at MAX_BYTES."""
    redirects: list[dict[str, Any]] = []
    cur, t0 = url, time.monotonic()
    try:
        with site_client(FETCH_TIMEOUT) as c:
            for hop in range(MAX_REDIRECTS + 1):
                validate_url_shape(cur)
                with c.stream("GET", cur, follow_redirects=False, headers={"Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"}) as r:
                    loc = r.headers.get("location")
                    if r.status_code in (301, 302, 303, 307, 308) and loc:
                        redirects.append({"url": cur, "status": r.status_code})
                        if hop == MAX_REDIRECTS:
                            raise XrayError(502, "could not fetch: too many redirects")
                        cur = urljoin(cur, loc)
                        continue
                    ctype = r.headers.get("content-type", "")
                    if ctype and "html" not in ctype.lower() and "xml" not in ctype.lower():
                        raise XrayError(422, f"This is not an HTML page (it is {ctype.split(';')[0].strip() or 'unknown'}).")
                    body, truncated = bytearray(), False
                    for chunk in r.iter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            truncated = True
                            break
                    enc = r.encoding or "utf-8"
                    try:
                        html = bytes(body).decode(enc, "replace")
                    except LookupError:
                        html = bytes(body).decode("utf-8", "replace")
                    headers = {k.lower(): v for k, v in r.headers.items()}
                    cookies = site_stack._cookie_names(r.headers.get_list("set-cookie"))
                    return Fetched(url=url, final_url=cur, status=r.status_code, headers=headers, html=html, size_bytes=len(body), redirects=redirects,
                                   elapsed_ms=round((time.monotonic() - t0) * 1000), truncated=truncated, cookies=cookies)
    except XrayError:
        raise
    except SSRFValidationError as exc:
        raise XrayError(422, str(exc)) from exc
    except (httpx.HTTPError, OSError, ssl.SSLError) as exc:
        raise XrayError(502, f"could not fetch: {str(exc)[:160] or type(exc).__name__}") from exc
    raise XrayError(502, "could not fetch: no answer")


def fetch_small(url: str, max_bytes: int = 200_000) -> dict[str, Any] | None:
    """A small side file (robots.txt, llms.txt) through the same safe client. None when it could not be fetched at all."""
    try:
        with site_client(8) as c:
            with c.stream("GET", url) as r:
                body = bytearray()
                for chunk in r.iter_bytes():
                    body += chunk
                    if len(body) > max_bytes:
                        break
                return {"status": r.status_code, "content_type": r.headers.get("content-type", ""), "text": bytes(body).decode(r.encoding or "utf-8", "replace")}
    except (httpx.HTTPError, OSError, ssl.SSLError, SSRFValidationError, LookupError):
        return None


def check_ssl(host: str, port: int = 443) -> dict[str, Any]:
    """The TLS certificate of the host, read over a connection to an already-validated public address (never to an unchecked one)."""
    out: dict[str, Any] = {"valid": None, "issuer": None, "expires_at": None, "days_left": None, "error": None}
    try:
        ips = resolve_and_validate(f"https://{host}:{port}/").resolved_ips
        v4 = [i for i in ips if ":" not in i]
        ip = (v4 or ips)[0]
        try:  # the same CA bundle our HTTP client trusts, so a page that loads over https is never reported as an untrusted certificate
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = ssl.create_default_context()
        with socket.create_connection((ip, port), timeout=6) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as tls:
                cert = tls.getpeercert() or {}
        issuer = dict(x[0] for x in cert.get("issuer", ()) if x)
        out["issuer"] = issuer.get("organizationName") or issuer.get("commonName")
        if cert.get("notAfter"):
            end = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), tz=timezone.utc)
            out["expires_at"] = end.isoformat()
            out["days_left"] = (end - datetime.now(timezone.utc)).days
        out["valid"] = True
    except ssl.SSLCertVerificationError as exc:
        out["valid"], out["error"] = False, f"Certificate not trusted: {str(exc.verify_message or exc)[:120]}"
    except (OSError, ssl.SSLError, SSRFValidationError) as exc:
        out["error"] = f"Could not read the certificate: {str(exc)[:120]}"
    return out


def rdap_lookup(domain: str) -> dict[str, Any]:
    """Domain registration facts for `domain` (age, registrar, expiry, name servers): RDAP through the IANA bootstrap, then WHOIS for TLDs without RDAP
    (.co and others). Implemented in services/domain_info.py; the name and signature stay because the callers and tests use them."""
    from . import domain_info
    return domain_info.lookup(domain)


# ----------------------------------------------------------------------------------------------------------------- parsing helpers
def _txt(s: Any, n: int | None = None) -> str:
    t = re.sub(r"\s+", " ", str(s or "")).strip()
    return t[:n] if n else t


def _meta(soup: BeautifulSoup, **attrs: str) -> str | None:
    tag = soup.find("meta", attrs=attrs)
    v = _txt(tag.get("content")) if tag and tag.get("content") is not None else ""
    return v or None


def _host_key(host: str) -> str:
    return _root((host or "").lower().removeprefix("www."))


def _same_page(a: str, b: str) -> bool:
    def n(u: str) -> str:
        p = urlsplit(u)
        return f"{p.scheme}://{p.netloc.lower().removeprefix('www.')}{(p.path or '/').rstrip('/') or '/'}?{p.query}".rstrip("?")
    return n(a) == n(b)


def _syllables(word: str) -> int:
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups) - (1 if w.endswith("e") and len(groups) > 1 and not w.endswith(("le", "ee")) else 0)
    return max(1, n)


def flesch(text: str) -> float | None:
    """Flesch reading ease (an English-language estimate); None when there is too little text to say anything."""
    words = re.findall(r"[A-Za-z']+", text)
    sentences = [s for s in re.split(r"[.!?]+\s", text) if len(re.findall(r"[A-Za-z']+", s)) >= 3]
    if len(words) < 100 or len(sentences) < 3:
        return None
    syl = sum(_syllables(w) for w in words)
    return round(206.835 - 1.015 * (len(words) / len(sentences)) - 84.6 * (syl / len(words)), 1)


def parse_json_ld(soup: BeautifulSoup) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """(blocks for the report, every schema object found, errors). A broken block is reported, never silently dropped."""
    blocks: list[dict[str, Any]] = []
    objects: list[dict[str, Any]] = []
    errors: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for x in node:
                walk(x)
        elif isinstance(node, dict):
            objects.append(node)
            if "@graph" in node:
                walk(node["@graph"])

    for i, tag in enumerate(soup.find_all("script", attrs={"type": re.compile(r"ld\+json", re.I)}), 1):
        raw = (tag.string or tag.get_text() or "").strip()
        try:
            data = json.loads(raw)
        except ValueError as exc:
            blocks.append({"type": None, "valid": False})
            errors.append(f"JSON-LD block {i} is not valid JSON: {str(exc)[:80]}")
            continue
        before = len(objects)
        walk(data)
        typed = next((o for o in objects[before:] if _types_of(o)), {})  # a @graph wrapper has no type of its own: use the first typed object
        t = _types_of(typed)[0] if typed else None
        blocks.append({"type": t if isinstance(t, str) else None, "valid": True})
    return blocks, objects, errors


def _types_of(obj: dict[str, Any]) -> list[str]:
    t = obj.get("@type")
    return [x for x in (t if isinstance(t, list) else [t]) if isinstance(x, str)]


# ----------------------------------------------------------------------------------------------------------------- tech
CMS_KEYS = {"wordpress", "shopify", "wix", "squarespace", "webflow", "ghost", "drupal", "joomla", "magento", "bigcommerce", "hubspot", "framer", "duda", "weebly", "godaddy", "blogger", "tilda"}
FRAMEWORK_KEYS = {"nextjs", "nuxt", "gatsby", "astro", "remix", "sveltekit", "docusaurus", "angular", "react", "vue", "svelte"}


def detect_tech(f: Fetched) -> dict[str, Any]:
    """What the page is built with, from its headers, cookies and HTML (services/tech_detect.py: a fingerprint list with the version and the evidence for each finding)."""
    h = f.headers
    found = tech_detect.detect(f.html, h, f.cookies)
    by_cat: dict[str, list[str]] = {}
    for d in found["detected"]:
        by_cat.setdefault(d["category"], []).append(f"{d['name']} {d['version']}" if d["version"] else d["name"])
    names = lambda *cats: [x for c in cats for x in by_cat.get(c, [])]  # noqa: E731
    cms_hit = next((d for d in found["detected"] if d["category"] in ("cms", "ecommerce")), None)
    cms = cms_hit["name"] if cms_hit else None
    return {
        "server": h.get("server"), "powered_by": h.get("x-powered-by"), "cms": cms, "cms_version": cms_hit["version"] if cms_hit else None, "frameworks": names("framework", "page_builder"), "js_libraries": names("js_library", "ui"),
        "analytics": names("analytics"), "tag_managers": names("tag_manager"), "ads_pixels": names("ads"), "cdn": names("cdn"), "compression": h.get("content-encoding"),
        "cache_control": h.get("cache-control"),
        "security_headers": {"hsts": "strict-transport-security" in h, "csp": "content-security-policy" in h, "x_frame_options": "x-frame-options" in h,
                             "x_content_type_options": "x-content-type-options" in h, "referrer_policy": "referrer-policy" in h, "permissions_policy": "permissions-policy" in h},
        # the full picture, grouped for display: every technology with its version and what showed it
        "groups": found["groups"], "detected": found["detected"], "plugins": found["plugins"], "theme": found["theme"],
    }


# ----------------------------------------------------------------------------------------------------------------- the checks
def _check(key: str, label: str, weight: int, fn: Callable[[dict[str, Any]], tuple[bool, str]], fix: str, applies: Callable[[dict[str, Any]], bool] | None = None) -> dict[str, Any]:
    """`applies`: when given and false for this page, the check is left out of the report (and of the score) instead of passing or failing."""
    return {"key": key, "label": label, "weight": weight, "fn": fn, "fix": fix, "applies": applies}


def _noindex(c: dict[str, Any]) -> bool:
    return "noindex" in ((c["meta"]["robots_meta"] or "") + " " + (c["meta"]["x_robots_tag"] or "")).lower()


def _author(c: dict[str, Any]) -> bool:
    return bool(c["_author_meta"] or c["_author_rel"] or any(o.get("author") or "person" in [t.lower() for t in _types_of(o)] for o in c["_objects"]))


def _org_ok(c: dict[str, Any]) -> bool:
    for o in c["_objects"]:
        if any(t.lower() in ORG_TYPES or t.lower().endswith("business") for t in _types_of(o)) and o.get("name") and o.get("sameAs"):
            return True
    return False


def _entity_names(c: dict[str, Any]) -> list[str]:
    return [str(o["name"]) for o in c["_objects"] if o.get("name") and any(t.lower() in ORG_TYPES or t.lower().endswith("business") for t in _types_of(o))]


HREFLANG_CODE = re.compile(r"^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$", re.I)


def _hreflang_problems(c: dict[str, Any]) -> list[str]:
    tags = c["meta"]["hreflang"]
    problems: list[str] = []
    codes = [t["lang"].strip().lower() for t in tags]
    bad = sorted({t["lang"] for t in tags if not HREFLANG_CODE.match(t["lang"].strip())})
    if bad:
        problems.append("invalid language code(s): " + ", ".join(bad))
    dupes = sorted({x for x in codes if codes.count(x) > 1})
    if dupes:
        problems.append("duplicate code(s): " + ", ".join(dupes))
    if len(set(codes)) > 1 and "x-default" not in codes:
        problems.append("no x-default entry")
    if not any(_same_page(t["url"], c["final_url"]) for t in tags):
        problems.append("no entry points back to this page")
    return problems


def _hreflang_check(c: dict[str, Any]) -> tuple[bool, str]:
    problems = _hreflang_problems(c)
    return (not problems, f"{len(c['meta']['hreflang'])} hreflang entries are valid." if not problems else "Problems: " + "; ".join(problems) + ".")


def _noun(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _direct_answer(c: dict[str, Any]) -> tuple[bool, str]:
    n = c["_first_answer_words"]
    if n is None:
        return False, "No paragraph found right after the main heading."
    return 25 <= n <= 70, f"The first paragraph after the main heading has {n} words (aim for 25 to 70)."


SEO_CHECKS = [
    _check("https", "Served over HTTPS", 8, lambda c: (c["https"], "The page is on https." if c["https"] else "The page was loaded over plain http."), "Move the site to HTTPS and redirect http to https."),
    _check("status_200", "Page answers with status 200", 10, lambda c: (c["status"] == 200, f"Status {c['status']}."), "Fix the page so it returns 200 (no errors, no soft 404)."),
    _check("title", "Title present, 30 to 60 characters", 10, lambda c: (bool(c["meta"]["title"]) and 30 <= c["meta"]["title_len"] <= 60,
                                                                       f"{c['meta']['title_len']} characters." if c["meta"]["title"] else "No <title> found."), "Write a unique title of 30 to 60 characters with the main phrase near the start."),
    _check("description", "Meta description present, 70 to 160 characters", 8, lambda c: (bool(c["meta"]["description"]) and 70 <= c["meta"]["description_len"] <= 160,
                                                                                         f"{c['meta']['description_len']} characters." if c["meta"]["description"] else "No meta description found."), "Add a meta description of 70 to 160 characters that sells the click."),
    _check("one_h1", "Exactly one H1", 8, lambda c: (c["content"]["headings"]["h1"] == 1, f"{c['content']['headings']['h1']} H1 headings."), "Use one H1 that says what the page is about."),
    _check("canonical", "Canonical tag points to this page", 6, lambda c: (c["meta"]["canonical_self"] is True,
                                                                         "Canonical points to this page." if c["meta"]["canonical_self"] else ("No canonical tag." if not c["meta"]["canonical"] else "Canonical points to a different address.")), "Add a self-referencing canonical link in <head>."),
    _check("indexable", "Not blocked from indexing (noindex)", 10, lambda c: (not _noindex(c), "Indexable." if not _noindex(c) else "A noindex rule is set (meta robots or X-Robots-Tag)."), "Remove the noindex rule if the page should appear on Google."),
    _check("viewport", "Mobile viewport meta tag", 6, lambda c: (bool(c["meta"]["viewport"]), c["meta"]["viewport"] or "No viewport meta tag."), 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.'),
    _check("lang", "Language declared on <html>", 3, lambda c: (bool(c["meta"]["lang"]), c["meta"]["lang"] or "No lang attribute."), 'Add lang="en" (or your language) to the <html> tag.'),
    _check("alt", "Images have alt text (90% or more)", 5, lambda c: (c["content"]["images"]["total"] == 0 or (1 - c["content"]["images"]["missing_alt"] / c["content"]["images"]["total"]) >= 0.9,
                                                                    f"{c['content']['images']['missing_alt']} of {c['content']['images']['total']} images have no alt attribute."), "Add short descriptive alt text to every meaningful image."),
    _check("og", "Open Graph tags present", 4, lambda c: (bool(c["social"]["og"]["title"] and c["social"]["og"]["image"]), "Open Graph title and image found." if c["social"]["og"]["title"] and c["social"]["og"]["image"] else "og:title or og:image is missing."), "Add og:title, og:description and og:image so shares look right."),
    _check("internal_links", "At least 3 internal links", 4, lambda c: (c["content"]["links"]["internal"] >= 3, f"{c['content']['links']['internal']} internal links."), "Link to related pages of your own site from the text."),
    _check("words", "300 words or more of content", 6, lambda c: (c["content"]["word_count"] >= 300, f"{c['content']['word_count']} words."), "Add useful content: thin pages rarely rank."),
    _check("redirects", "No redirect chain longer than 2", 3, lambda c: (len(c["redirects"]) <= 2, f"{len(c['redirects'])} redirect hop(s)."), "Point links straight at the final address."),
]
SEO_CHECKS += [
    _check("hreflang", "hreflang is valid (codes, x-default, self-reference, no duplicates)", 3, _hreflang_check,
           "Use valid codes like en, en-IN or x-default, list each page once, include the page itself and an x-default entry.", applies=lambda c: bool(c["meta"]["hreflang"])),
    _check("twitter_card", "Twitter card present", 2, lambda c: (bool(c["social"]["twitter"]["card"]), c["social"]["twitter"]["card"] or "No twitter:card meta tag."), 'Add <meta name="twitter:card" content="summary_large_image">.'),
    _check("description_unique", "Meta description differs from the title", 3, lambda c: (bool(c["meta"]["description"]) and (c["meta"]["description"] or "").strip().lower() != (c["meta"]["title"] or "").strip().lower(),
                                                                                       "The description is its own text." if c["meta"]["description"] and (c["meta"]["description"] or "").strip().lower() != (c["meta"]["title"] or "").strip().lower() else "The description is missing or the same as the title."),
           "Write a description that adds to the title instead of repeating it."),
    _check("single_canonical", "No more than one canonical tag", 3, lambda c: (c["_canonical_count"] <= 1, _noun(c["_canonical_count"], "canonical tag") + " found."), "Keep a single <link rel=canonical>: several can make Google ignore all of them."),
    _check("no_mixed_content", "No http:// resources on the https page", 4, lambda c: (not c["_mixed"], "No insecure resources." if not c["_mixed"] else _noun(len(c["_mixed"]), "insecure resource") + ", e.g. " + c["_mixed"][0][:80]),
           "Load every script, style, image and frame over https.", applies=lambda c: c["https"]),
    _check("page_weight", "HTML document under 3 MB", 2, lambda c: (not c["_truncated"] and c["_size_bytes"] < 3 * 1024 * 1024,
                                                                  "At least 2 MB of HTML (reading stops at 2 MB)." if c["_truncated"] else f"{round(c['_size_bytes'] / 1024)} KB of HTML."), "Trim inline scripts, styles and repeated markup from the HTML."),
    _check("response_time", "Server answers in under 1500 ms", 3, lambda c: (c["_elapsed_ms"] < 1500, f"{c['_elapsed_ms']} ms from our server."), "Speed up the server: caching, a faster host or less work per request."),
    _check("favicon", "A favicon is declared", 1, lambda c: (bool(c["meta"]["favicon"]), c["meta"]["favicon"] or 'No <link rel="icon">.'), 'Add <link rel="icon" href="/favicon.ico">.'),
    # Accessibility, from the real DOM. Colour contrast and keyboard behaviour need a rendered, interactive page and are not tested here.
    _check("a11y_lang", "Accessibility: page language is set on <html>", 2, lambda c: (bool(c["meta"]["lang"]), c["meta"]["lang"] or "No lang attribute."), 'Add lang="en" (or the page language) to <html> so screen readers use the right voice.'),
    _check("a11y_img_alt", "Accessibility: every image has an alt attribute", 3, lambda c: (c["content"]["images"]["missing_alt"] == 0, _noun(c["content"]["images"]["missing_alt"], "image") + f" of {c['content']['images']['total']} without an alt attribute."),
           'Give every image an alt attribute (alt="" for purely decorative ones).'),
    _check("a11y_form_labels", "Accessibility: form fields have labels", 3, lambda c: (c["_a11y"]["unlabeled"] == 0, f"{c['_a11y']['unlabeled']} of {c['_a11y']['fields']} fields without a label." if c["_a11y"]["fields"] else "No form fields on the page."),
           "Connect each field to a <label for>, or add aria-label."),
    _check("a11y_link_text", "Accessibility: links have readable text", 3, lambda c: (c["_a11y"]["empty_links"] == 0, _noun(c["_a11y"]["empty_links"], "link") + " with no text, aria-label or image alt."), "Give each link visible text or an aria-label that says where it goes."),
    _check("a11y_main", "Accessibility: one main landmark", 2, lambda c: (c["_a11y"]["mains"] == 1, _noun(c["_a11y"]["mains"], "main landmark") + " found."), "Wrap the page's main content in one <main> element."),
    _check("a11y_skip_nav", "Accessibility: skip link or navigation landmark", 2, lambda c: (c["_a11y"]["skip"] or c["_a11y"]["nav"], "A skip link was found." if c["_a11y"]["skip"] else ("A <nav> landmark was found." if c["_a11y"]["nav"] else "No skip link and no <nav> landmark.")),
           'Add a "Skip to content" link at the top and wrap the menu in <nav>.'),
    _check("a11y_heading_order", "Accessibility: headings do not skip levels", 2, lambda c: (c["_outline_ok"], "Heading levels are in order." if c["_outline_ok"] else "A heading level is skipped (for example H2 to H4)."), "Move down one level at a time: H1, H2, H3."),
    _check("a11y_button_names", "Accessibility: buttons have names", 2, lambda c: (c["_a11y"]["unnamed_buttons"] == 0, _noun(c["_a11y"]["unnamed_buttons"], "button") + " with no text or aria-label."), "Give icon-only buttons an aria-label."),
    _check("a11y_tabindex", "Accessibility: no positive tabindex", 1, lambda c: (c["_a11y"]["tabindex_positive"] == 0, _noun(c["_a11y"]["tabindex_positive"], "element") + " with tabindex above 0."), "Remove tabindex values above 0: they break the natural tab order."),
]
AEO_CHECKS = [
    _check("faq_schema", "FAQPage, QAPage or HowTo schema", 8, lambda c: (bool({t.lower() for t in c["schema"]["types"]} & {"faqpage", "qapage", "howto"}), ", ".join(c["schema"]["types"]) or "No structured data."), "Add FAQPage or HowTo JSON-LD that matches the questions on the page."),
    _check("question_headings", "Question-style headings", 7, lambda c: (c["_question_headings"] >= 2, f"{c['_question_headings']} question-style H2/H3 headings."), "Phrase some H2/H3 headings as the questions people ask."),
    _check("direct_answer", "A concise direct answer after the heading", 8, _direct_answer, "Start with a 25 to 70 word paragraph that answers the page's main question."),
    _check("lists_tables", "Lists or tables", 4, lambda c: (c["_lists"] or c["_tables"] > 0, f"{c['_lists']} list(s) and {c['_tables']} table(s)."), "Use bullet lists or a table for steps, options or comparisons."),
    _check("short_paragraphs", "Short paragraphs (median 80 words or less)", 5, lambda c: (c["_para_median"] is not None and c["_para_median"] <= 80,
                                                                                         f"Median paragraph: {c['_para_median']} words." if c["_para_median"] is not None else "Fewer than 3 paragraphs."), "Break long blocks of text into short paragraphs."),
    _check("date", "A published or updated date", 5, lambda c: (c["_has_date"], "A date is declared." if c["_has_date"] else "No <time>, meta or schema date found."), "Show and mark up the published and updated dates."),
    _check("author", "An author is named", 5, lambda c: (_author(c), "Author found." if _author(c) else "No author meta, rel=author or Person schema."), "Name the author and mark it up (rel=author or Person schema)."),
    _check("outline", "Headings in order, no skipped levels", 5, lambda c: (bool(c["content"]["outline"]) and c["_outline_ok"], "Heading levels are in order." if c["_outline_ok"] else "A heading level is skipped (for example H1 to H3)."), "Keep headings nested: H1, then H2, then H3."),
    _check("descriptive_title", "Descriptive title (not just a brand)", 4, lambda c: (len(re.findall(r"[A-Za-z0-9']+", c["meta"]["title"] or "")) >= 3, c["meta"]["title"] or "No title."), "Make the title describe the page, not only the brand."),
]
GEO_CHECKS = [
    _check("ai_crawlers", "AI crawlers are allowed in robots.txt", 12, lambda c: (c["robots"]["found_or_none"] and all(b["allowed"] is not False for b in c["robots"]["ai_crawlers"] if b["bot"] in MAIN_AI_BOTS),
                                                                                  "Blocked: " + (", ".join(b["bot"] for b in c["robots"]["ai_crawlers"] if b["allowed"] is False) or "none") if c["robots"]["found_or_none"] else "robots.txt could not be read."), "Allow GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot and PerplexityBot in robots.txt if you want to be cited."),
    _check("llms_txt", "llms.txt exists", 5, lambda c: (c["llms_txt"]["found"], c["llms_txt"]["url"] if c["llms_txt"]["found"] else "No /llms.txt."), "Publish /llms.txt describing your site for AI assistants."),
    _check("org_schema", "Organization / LocalBusiness / Person schema with name and sameAs", 10, lambda c: (_org_ok(c), "Entity schema with name and sameAs found." if _org_ok(c) else "No entity schema with both name and sameAs."), "Add Organization or LocalBusiness JSON-LD with name and sameAs links."),
    _check("entity_consistent", "Entity name matches the title or H1", 6, lambda c: (any(n.lower() in ((c["meta"]["title"] or "") + " " + " ".join(c["content"]["h1_texts"])).lower() for n in _entity_names(c)),
                                                                                    "Schema name appears in the title or H1." if _entity_names(c) else "No entity name in the schema to compare."), "Use the same business name in schema, title and H1."),
    _check("outbound", "Links out to other sources", 4, lambda c: (c["content"]["links"]["external"] >= 1, f"{c['content']['links']['external']} external links."), "Cite and link to authoritative sources."),
    _check("eeat", "Author / E-E-A-T signal", 6, lambda c: (_author(c), "Author signal found." if _author(c) else "No author signal."), "Show who wrote it and why they are qualified."),
    _check("numbers", "Facts and figures in the text (3 or more)", 4, lambda c: (c["_numbers"] >= 3, f"{c['_numbers']} numbers in the text."), "Add concrete numbers, dates and statistics."),
    _check("sitemap", "Sitemap declared in robots.txt", 4, lambda c: (bool(c["robots"]["sitemaps"]), ", ".join(c["robots"]["sitemaps"][:2]) or "No Sitemap: line."), "Add a Sitemap: line to robots.txt."),
    _check("cert", "Valid HTTPS certificate with more than 14 days left", 5, lambda c: (bool(c["ssl"]["valid"]) and (c["ssl"]["days_left"] or 0) > 14, f"{c['ssl']['days_left']} days left." if c["ssl"]["valid"] else (c["ssl"]["error"] or "No certificate read.")), "Renew the certificate before it expires."),
    _check("not_noindex", "Not blocked by noindex", 8, lambda c: (not _noindex(c), "Not blocked." if not _noindex(c) else "A noindex rule is set."), "Remove the noindex rule."),
]


def _score(checks: list[dict[str, Any]], ctx: dict[str, Any]) -> dict[str, Any]:
    out = []
    for ch in checks:
        applies = ch.get("applies")
        if applies is not None:
            try:
                if not applies(ctx):
                    continue
            except Exception:  # noqa: BLE001 - if we cannot tell whether it applies, it is evaluated
                pass
        try:
            passed, detail = ch["fn"](ctx)
        except Exception as exc:  # noqa: BLE001 - a check that cannot be evaluated counts as not passed, with the reason
            passed, detail = False, f"Could not evaluate: {type(exc).__name__}"
        out.append({"key": ch["key"], "label": ch["label"], "passed": bool(passed), "weight": ch["weight"], "detail": detail, "fix": ch["fix"]})
    total = sum(c["weight"] for c in out)
    got = sum(c["weight"] for c in out if c["passed"])
    return {"score": round(got / total * 100) if total else 0, "passed": sum(1 for c in out if c["passed"]), "total": len(out), "checks": out}


def _rels(tag: Any) -> list[str]:
    r = tag.get("rel") or []
    return [x.lower() for x in (r if isinstance(r, list) else [r])]


def _mixed_content(soup: BeautifulSoup) -> list[str]:
    """http:// resources a page loads (scripts, styles, images, frames, media, forms), links to other pages excluded."""
    found: list[str] = []
    for tag in soup.find_all(True):
        if tag.name == "a":
            continue
        vals = [tag.get(a) for a in ("src", "poster", "data")]
        if tag.name == "link" and set(_rels(tag)) & {"stylesheet", "icon", "preload", "modulepreload", "shortcut"}:
            vals.append(tag.get("href"))
        if tag.name == "form":
            vals.append(tag.get("action"))
        for v in vals:
            if isinstance(v, str) and v.strip().lower().startswith("http://") and v.strip() not in found:
                found.append(v.strip())
    return found[:20]


def _has_name(tag: Any) -> bool:
    if (tag.get("aria-label") or "").strip() or (tag.get("aria-labelledby") or "").strip() or (tag.get("title") or "").strip():
        return True
    if tag.get_text(strip=True):
        return True
    return any((i.get("alt") or "").strip() for i in tag.find_all("img"))


def _a11y_facts(soup: BeautifulSoup) -> dict[str, Any]:
    labels_for = {l.get("for") for l in soup.find_all("label") if l.get("for")}
    fields = [f for f in soup.find_all(["input", "select", "textarea"]) if not (f.name == "input" and (f.get("type") or "text").lower() in ("hidden", "submit", "button", "reset", "image"))]
    unlabeled = 0
    for f in fields:
        ok = bool((f.get("aria-label") or "").strip() or (f.get("aria-labelledby") or "").strip() or (f.get("title") or "").strip() or (f.get("id") and f.get("id") in labels_for) or f.find_parent("label"))
        unlabeled += 0 if ok else 1
    anchors = soup.find_all("a", href=True)
    empty_links = sum(1 for a in anchors if not _has_name(a))
    buttons = soup.find_all("button") + soup.find_all(attrs={"role": "button"})
    unnamed = sum(1 for b in buttons if not _has_name(b))
    unnamed += sum(1 for i in soup.find_all("input", attrs={"type": re.compile(r"^(submit|button|reset)$", re.I)}) if not ((i.get("value") or "").strip() or (i.get("aria-label") or "").strip() or (i.get("title") or "").strip()))
    first = anchors[:10]
    skip = any((a["href"].startswith("#") and len(a["href"]) > 1) and re.search(r"skip|jump to|main content", a.get_text(" ", strip=True) + " " + (a.get("aria-label") or ""), re.I) for a in first)
    tab_pos = 0
    for t in soup.find_all(attrs={"tabindex": True}):
        try:
            tab_pos += 1 if int(str(t.get("tabindex")).strip()) > 0 else 0
        except ValueError:
            pass
    return {"fields": len(fields), "unlabeled": unlabeled, "empty_links": empty_links, "unnamed_buttons": unnamed, "skip": bool(skip),
            "nav": bool(soup.find("nav") or soup.find(attrs={"role": "navigation"})), "mains": len(soup.find_all("main")) + len(soup.find_all(attrs={"role": "main"})), "tabindex_positive": tab_pos}


def _dom_counts(html: str) -> tuple[int, int, int]:
    """(visible words, links, images) of a page's HTML, the same way the report counts them."""
    soup = BeautifulSoup(html, "html.parser")
    links = len(soup.find_all("a", href=True))
    images = len(soup.find_all("img"))
    for t in soup(["script", "style", "noscript", "template", "svg"]):
        t.decompose()
    return len(re.findall(r"\w+", _txt((soup.body or soup).get_text(" ")))), links, images


# ----------------------------------------------------------------------------------------------------------------- render mode (headless Chrome)
def assert_own_site(url: str, site: str | None) -> None:
    """Render mode only runs for the project's own website: Chrome fetches with its own network stack, so it must never be pointed at someone else's address."""
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    own_host = (urlsplit(site if "://" in (site or "") else f"https://{site}").hostname or "").lower().removeprefix("www.") if site else ""
    if not host or not own_host:
        raise XrayError(422, OWN_SITE_ONLY)
    root = _root(own_host)
    if host == own_host or host == root or host.endswith("." + root):
        return
    raise XrayError(422, OWN_SITE_ONLY)


def find_chrome() -> str | None:
    """The Chrome / Chromium / Edge to render with: CHROME_PATH (what Lighthouse's launcher honours too), then the usual names and install folders."""
    env = os.environ.get("CHROME_PATH")
    if env and os.path.isfile(env):
        return env
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge", "microsoft-edge"):
        found = shutil.which(name)
        if found:
            return found
    roots = [os.environ.get(k) for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
    candidates = [os.path.join(r, *rest) for r in roots if r for rest in (("Google", "Chrome", "Application", "chrome.exe"), ("Microsoft", "Edge", "Application", "msedge.exe"))]
    candidates += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/snap/bin/chromium"]
    return next((c for c in candidates if os.path.isfile(c)), None)


def _kill_tree(proc: subprocess.Popen) -> None:
    """Stop Chrome and every process it started."""
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, timeout=10)
        else:
            import signal
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:  # noqa: BLE001 - already gone
        pass
    try:
        proc.kill()
    except Exception:  # noqa: BLE001
        pass


def _run_chrome(args: list[str], timeout: float = CHROME_TIMEOUT, cap: int = CHROME_MAX_BYTES) -> tuple[int | None, bytes, bool]:
    """Run Chrome with an argument list (never a shell). Returns (exit code or None when it was killed, stdout read up to `cap`, whether it timed out)."""
    kwargs: dict[str, Any] = {"stdout": subprocess.PIPE, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
    if sys.platform != "win32":
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(args, **kwargs)
    buf = bytearray()

    def drain() -> None:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            if len(buf) < cap:
                buf.extend(chunk[: cap - len(buf)])

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    try:
        proc.wait(timeout=timeout)
        reader.join(timeout=5)
        return proc.returncode, bytes(buf), False
    except subprocess.TimeoutExpired:
        _kill_tree(proc)
        reader.join(timeout=5)
        return None, bytes(buf), True


def _chrome_args(chrome: str, url: str, profile_dir: str, host: str, ip: str | None, budget_ms: int | None = None) -> list[str]:
    rules = [f"MAP {h} ~NOTFOUND" for h in CHROME_BLOCKED_HOSTS]
    if ip:  # the page's own host is pinned to the address we already validated, so a DNS change after the check cannot send Chrome inside
        rules.insert(0, f"MAP {host} {'[' + ip + ']' if ':' in ip else ip}")
    args = [chrome, "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--dump-dom", f"--virtual-time-budget={budget_ms or CHROME_BUDGET_MS}",
            f"--user-data-dir={profile_dir}", f"--host-resolver-rules={', '.join(rules)}", "--disable-background-networking", "--disable-dev-shm-usage", "--mute-audio", "--window-size=1366,900"]
    if sys.platform != "win32" and hasattr(os, "geteuid") and os.geteuid() == 0:
        args.append("--no-sandbox")  # Chrome refuses to start as root without it; as a normal user the sandbox stays on
    args.append(url)
    return args


CHROME_SLOTS = threading.BoundedSemaphore(int(os.environ.get("CHROME_MAX_CONCURRENT", "2")))  # headless Chrome is hundreds of MB: only a few may run at once, however many users ask
CHROME_WAIT_SECONDS = 25


def chrome_dump(chrome: str, url: str) -> tuple[str | None, str | None]:
    """`_chrome_dump` behind a global limit on how many Chrome processes run at the same time. A caller that cannot get a slot in 25 s is told so (and falls back to the plain read)."""
    if not CHROME_SLOTS.acquire(timeout=CHROME_WAIT_SECONDS):
        return None, "The server is busy rendering other pages. Try again in a moment."
    try:
        return _chrome_dump(chrome, url)
    finally:
        CHROME_SLOTS.release()


def _chrome_dump(chrome: str, url: str) -> tuple[str | None, str | None]:
    """The DOM of `url` after Chrome has run its scripts: (html, None), or (None, why not). The profile folder is temporary and always removed."""
    try:
        validated = resolve_and_validate(url)
    except SSRFValidationError as exc:
        return None, str(exc)
    ips = list(validated.resolved_ips)
    ip = next((i for i in ips if ":" not in i), ips[0] if ips else None)
    code, out, timed_out = None, b"", True
    for attempt, (limit, budget) in enumerate(((CHROME_TIMEOUT, CHROME_BUDGET_MS), (CHROME_RETRY_TIMEOUT, 3000))):
        profile = tempfile.mkdtemp(prefix="xray-chrome-")  # a fresh temporary profile for every attempt, always removed
        try:
            code, out, timed_out = _run_chrome(_chrome_args(chrome, url, profile, validated.hostname, ip, budget), timeout=limit)
        except OSError as exc:
            return None, f"Chrome could not be started: {str(exc)[:100]}"
        finally:
            shutil.rmtree(profile, ignore_errors=True)
        if not timed_out:
            break  # one retry only, with less waiting time: a page that is still not ready after that is read without rendering
    if timed_out:
        return None, f"Chrome could not finish loading this page within {CHROME_TIMEOUT + CHROME_RETRY_TIMEOUT} seconds (two tries), so it was read without rendering."
    html = out.decode("utf-8", "replace")
    if code not in (0, None) or len(html.strip()) < 30 or "<" not in html:
        return None, "Chrome could not render the page, so it was read without rendering."
    return html, None


def render_page(f: Fetched, site: str | None) -> tuple[Fetched, dict[str, Any]]:
    """Compare the page as sent (raw HTML) with the page after Chrome ran its scripts, and analyse the rendered one."""
    raw_words, raw_links, raw_imgs = _dom_counts(f.html)
    info: dict[str, Any] = {"mode": "html", "note": None, "raw_word_count": raw_words, "rendered_word_count": None, "js_added_links": None, "js_added_images": None, "js_required": None}
    try:
        assert_own_site(f.final_url, site)  # a redirect to another website is never rendered
    except XrayError:
        info["note"] = "The page redirects to another website, so it was read without rendering."
        return f, info
    chrome = find_chrome()
    if not chrome:
        info["note"] = "Chrome is not available on this server"
        return f, info
    html, why = chrome_dump(chrome, f.final_url)
    if html is None:
        info["note"] = why
        return f, info
    words, links, imgs = _dom_counts(html)
    info.update(mode="chrome", note="Rendered in headless Chrome: the numbers in this report come from the rendered page.", rendered_word_count=words,
                js_added_links=max(0, links - raw_links), js_added_images=max(0, imgs - raw_imgs),
                js_required=bool((words - raw_words >= 50 and words >= raw_words * 1.3) or (raw_words < 50 and words >= 100)))
    return replace(f, html=html), info


# ----------------------------------------------------------------------------------------------------------------- the report
def robots_info(origin: str, final_url: str, fetch: Callable[[str], dict[str, Any] | None]) -> dict[str, Any]:
    url = f"{origin}/robots.txt"
    out: dict[str, Any] = {"url": url, "found": False, "allows_page": None, "sitemaps": [], "ai_crawlers": [{"bot": b, "allowed": None} for b in AI_BOTS], "found_or_none": False}
    got = fetch(url)
    if got is None:
        return out
    text = got["text"]
    looks_real = got["status"] == 200 and re.search(r"(?im)^\s*(user-agent|sitemap|disallow|allow)\s*:", text[:20000]) and "html" not in got["content_type"].lower()
    if got["status"] in (404, 410) or (got["status"] == 200 and not looks_real):
        out["found_or_none"] = True  # no robots.txt means nothing is blocked
        out["allows_page"] = True
        out["ai_crawlers"] = [{"bot": b, "allowed": True} for b in AI_BOTS]
        return out
    if not looks_real:
        return out
    rp = robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    out.update(found=True, found_or_none=True, allows_page=bool(rp.can_fetch("*", final_url)), ai_crawlers=[{"bot": b, "allowed": bool(rp.can_fetch(b, final_url))} for b in AI_BOTS],
               sitemaps=[m.group(1).strip() for m in re.finditer(r"(?im)^\s*sitemap\s*:\s*(\S+)", text)][:10])
    return out


def analyse(f: Fetched, robots: dict[str, Any], llms: dict[str, Any] | None, ssl_info: dict[str, Any], domain: dict[str, Any], notes: list[str] | None = None, rendering: dict[str, Any] | None = None) -> dict[str, Any]:
    notes = list(notes or [])
    soup = BeautifulSoup(f.html, "html.parser")
    final = f.final_url
    host = urlsplit(final).netloc
    page_key = _host_key(urlsplit(final).hostname or "")
    # ---- meta
    title_tag = soup.find("title")
    title = _txt(title_tag.get_text()) if title_tag else ""
    desc = _meta(soup, name=re.compile(r"^description$", re.I)) or ""
    canon_tag = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    canonical = urljoin(final, canon_tag["href"]) if canon_tag and canon_tag.get("href") else None
    html_tag = soup.find("html")
    charset_tag = soup.find("meta", charset=True)
    http_eq = soup.find("meta", attrs={"http-equiv": re.compile(r"content-type", re.I)})
    charset = (charset_tag["charset"] if charset_tag else None) or (re.search(r"charset=([\w-]+)", http_eq.get("content", ""), re.I).group(1) if http_eq and re.search(r"charset=([\w-]+)", http_eq.get("content", ""), re.I) else None) \
        or (re.search(r"charset=([\w-]+)", f.headers.get("content-type", ""), re.I).group(1) if re.search(r"charset=([\w-]+)", f.headers.get("content-type", ""), re.I) else None)
    icon = soup.find("link", rel=lambda v: v and any("icon" in x for x in (v if isinstance(v, list) else [v])))
    hreflang = [{"lang": t["hreflang"], "url": urljoin(final, t["href"])} for t in soup.find_all("link", rel=lambda v: v and "alternate" in (v if isinstance(v, list) else [v])) if t.get("hreflang") and t.get("href")]
    meta = {
        "title": title or None, "title_len": len(title), "description": desc or None, "description_len": len(desc), "canonical": canonical,
        "canonical_self": (_same_page(canonical, final) if canonical else None), "robots_meta": _meta(soup, name=re.compile(r"^robots$", re.I)),
        "x_robots_tag": f.headers.get("x-robots-tag"), "lang": _txt(html_tag.get("lang")) or None if html_tag else None, "charset": charset,
        "viewport": _meta(soup, name=re.compile(r"^viewport$", re.I)), "hreflang": hreflang, "favicon": urljoin(final, icon["href"]) if icon and icon.get("href") else None,
        "generator": _meta(soup, name=re.compile(r"^generator$", re.I)),
    }
    og_keys = ["title", "description", "image", "type", "url", "site_name"]
    social = {"og": {k: _meta(soup, property=f"og:{k}") for k in og_keys},
              "twitter": {k: (_meta(soup, name=f"twitter:{k}") or _meta(soup, property=f"twitter:{k}")) for k in ["card", "title", "description", "image"]}}
    # ---- content
    for t in soup(["script", "style", "noscript", "template", "svg"]):
        t.decompose()
    headings = {f"h{i}": len(soup.find_all(f"h{i}")) for i in range(1, 7)}
    heads = [(int(h.name[1]), _txt(h.get_text())) for h in soup.find_all(re.compile(r"^h[1-6]$")) if _txt(h.get_text())]
    outline = [{"level": lv, "text": tx[:120]} for lv, tx in heads[:60]]
    levels = [lv for lv, _ in heads]
    outline_ok = all(b - a <= 1 for a, b in zip(levels, levels[1:]))
    body = soup.body or soup
    text = _txt(body.get_text(" "))
    words = re.findall(r"\w+", text)
    imgs = soup.find_all("img")
    ps = [_txt(p.get_text()) for p in soup.find_all("p")]
    plen = [len(re.findall(r"\w+", p)) for p in ps if len(re.findall(r"\w+", p)) >= 5]
    internal = external = nofollow = 0
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "sms:")):
            continue
        u = urlsplit(urljoin(final, href))
        if u.scheme not in ("http", "https"):
            continue
        if _host_key(u.hostname or "") == page_key:
            internal += 1
        else:
            external += 1
        if "nofollow" in (a.get("rel") or []):
            nofollow += 1
    first = soup.find(["h1"]) or soup.find("h2")
    first_answer = None
    if first:
        nxt = first.find_next("p")
        first_answer = len(re.findall(r"\w+", _txt(nxt.get_text()))) if nxt else None
    content = {"word_count": len(words), "headings": headings, "outline": outline, "h1_texts": [tx[:200] for lv, tx in heads if lv == 1][:10],
               "images": {"total": len(imgs), "missing_alt": sum(1 for i in imgs if i.get("alt") is None), "lazy": sum(1 for i in imgs if (i.get("loading") or "").lower() == "lazy"),
                          "alts": [str(i.get("alt")).strip()[:120] for i in imgs if (i.get("alt") or "").strip()][:60]},  # the first 60 non-empty alt texts: what the images say about themselves
               "links": {"internal": internal, "external": external, "nofollow": nofollow}, "reading_ease": flesch(text)}
    if content["reading_ease"] is None:
        notes.append("Reading ease needs at least 100 words of English text; it is left empty here.")
    # ---- schema (parsed from the original HTML: scripts were removed from the soup above)
    full = BeautifulSoup(f.html, "html.parser")
    blocks, objects, schema_errors = parse_json_ld(full)
    types = list(dict.fromkeys(t for o in objects for t in _types_of(o)))
    itemtypes = [re.sub(r"^.*/", "", t.get("itemtype", "")) for t in full.find_all(attrs={"itemtype": True})]
    types = list(dict.fromkeys(types + [t for t in itemtypes if t]))
    schema = {"json_ld": blocks, "types": types, "microdata": bool(full.find(attrs={"itemscope": True})), "rdfa": bool(full.find(attrs={"typeof": True}) or full.find(attrs={"vocab": True})), "errors": schema_errors}
    has_date = bool(full.find("time", attrs={"datetime": True}) or _meta(full, property="article:published_time") or _meta(full, property="article:modified_time") or full.find(attrs={"itemprop": re.compile(r"date(Published|Modified)", re.I)})
                    or any(o.get("datePublished") or o.get("dateModified") for o in objects))
    ctx: dict[str, Any] = {
        "https": urlsplit(final).scheme == "https", "status": f.status, "meta": meta, "social": social, "content": content, "schema": schema, "redirects": f.redirects,
        "robots": robots, "llms_txt": llms or {"found": False, "url": None}, "ssl": ssl_info, "_objects": objects,
        "_author_meta": bool(_meta(full, name=re.compile(r"^author$", re.I))), "_author_rel": bool(full.find("a", rel=lambda v: v and "author" in (v if isinstance(v, list) else [v])) or full.find(attrs={"itemprop": "author"})),
        "_question_headings": sum(1 for lv, tx in heads if lv in (2, 3) and (tx.rstrip().endswith("?") or tx.lower().split(" ")[0] in QUESTION_WORDS)),
        "_first_answer_words": first_answer, "_lists": sum(len(l.find_all("li")) for l in soup.find_all(["ul", "ol"])) >= 3, "_tables": len(soup.find_all("table")),
        "_para_median": int(statistics.median(plen)) if len(plen) >= 3 else None, "_has_date": has_date, "_outline_ok": outline_ok, "_numbers": len(re.findall(r"\b\d[\d,.]*%?", text)),
        "final_url": final, "_canonical_count": len(full.find_all("link", rel=lambda v: bool(v) and "canonical" in (v if isinstance(v, list) else [v]))),
        "_mixed": _mixed_content(full) if urlsplit(final).scheme == "https" else [], "_size_bytes": f.size_bytes, "_truncated": f.truncated, "_elapsed_ms": f.elapsed_ms, "_a11y": _a11y_facts(full),
    }
    scores = {"seo": _score(SEO_CHECKS, ctx), "aeo": _score(AEO_CHECKS, ctx), "geo": _score(GEO_CHECKS, ctx)}
    failed = [{"area": area.upper(), "label": c["label"], "fix": c["fix"], "weight": c["weight"]} for area, s in scores.items() for c in s["checks"] if not c["passed"]]
    failed.sort(key=lambda x: -x["weight"])
    summary = [{"area": x["area"], "label": x["label"], "fix": x["fix"]} for x in failed[:6]]
    if f.truncated:
        notes.append("The page is larger than 2 MB: only the first 2 MB were read.")
    notes.append("Sizes in this report are the HTML document only. Use “Measure full page” at the bottom for the whole page weight (images, scripts, styles, fonts) and the colour contrast test.")
    if rendering and rendering.get("note"):
        notes.append(rendering["note"])
    if robots["ai_crawlers"] and robots["ai_crawlers"][0]["allowed"] is None:
        notes.append("robots.txt could not be read, so crawler access is unknown.")
    if domain.get("error"):
        notes.append(f"Domain age is unavailable: {domain['error']}")
    if ssl_info.get("error") and ctx["https"]:
        notes.append(ssl_info["error"])
    return {
        "url": f.url, "final_url": final, "fetched_at": datetime.now(timezone.utc).isoformat(), "status": f.status, "response_ms": f.elapsed_ms, "size_kb": round(f.size_bytes / 1024, 1),
        "redirects": f.redirects, "https": ctx["https"], "meta": meta, "social": social, "content": content, "schema": schema, "tech": detect_tech(f), "domain": domain, "ssl": ssl_info,
        "robots": {k: v for k, v in robots.items() if k != "found_or_none"}, "llms_txt": ctx["llms_txt"], "scores": scores, "summary": summary, "notes": notes, "host": host,
        "rendering": rendering or {"mode": "html", "note": None, "raw_word_count": content["word_count"], "rendered_word_count": None, "js_added_links": None, "js_added_images": None, "js_required": None},
    }


def run(url: str, render: bool = False, own_site: str | None = None) -> dict[str, Any]:
    """The whole X-Ray of one page: fetch it, its robots.txt and llms.txt, the certificate and the domain registration.
    With render=True (the project's own website only) the page is also loaded in headless Chrome and analysed as Chrome sees it."""
    url = normalise_url(url)
    if render:
        assert_own_site(url, own_site)
    assert_public(url)
    f = fetch_page(url)
    p = urlsplit(f.final_url)
    origin = f"{p.scheme}://{p.netloc}"
    robots = robots_info(origin, f.final_url, fetch_small)
    llms_raw = fetch_small(f"{origin}/llms.txt")
    llms = {"found": False, "url": None}
    if llms_raw and llms_raw["status"] == 200 and llms_raw["text"].strip() and not llms_raw["text"].lstrip().startswith("<") and "html" not in llms_raw["content_type"].lower():
        llms = {"found": True, "url": f"{origin}/llms.txt"}
    ssl_info = check_ssl(p.hostname or "") if p.scheme == "https" else {"valid": None, "issuer": None, "expires_at": None, "days_left": None, "error": "The page is not served over https."}
    domain = rdap_lookup(_root((p.hostname or "").removeprefix("www.")))
    rendering = None
    if render:
        f, rendering = render_page(f, own_site)
    return analyse(f, robots, llms, ssl_info, domain, rendering=rendering)
