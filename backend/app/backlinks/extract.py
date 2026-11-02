"""Hyperlink extraction from HTML (PRD 10.1): anchor text, rel values, link type, placement, internal/external."""
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .urls import normalize_url, registrable_domain

MAX_ANCHOR = 300
_SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "sms:", "#")
_REL_KEEP = {"nofollow", "sponsored", "ugc", "me"}  # rel values that describe the link relationship (not noopener/noreferrer)


@dataclass
class ExtractedLink:
    target_url: str
    anchor_text: str | None
    rel_attributes: list[str]
    link_type: str  # text | image | other
    placement: str  # main | navigation | footer | sidebar | unknown
    internal: bool
    instance: int = 0  # ordinal among links to the same target on this page
    context_text: str | None = field(default=None, repr=False)


@dataclass
class PageExtract:
    title: str | None
    snippet: str | None
    canonical: str | None
    robots_meta: str | None
    links: list[ExtractedLink]
    base_url: str

    @property
    def noindex(self) -> bool:
        return "noindex" in (self.robots_meta or "").lower()

    @property
    def nofollow_all(self) -> bool:
        return "nofollow" in (self.robots_meta or "").lower()


def _placement(a: Tag) -> str:
    for parent in a.parents:
        name = (parent.name or "").lower()
        if name in ("nav",):
            return "navigation"
        if name == "footer":
            return "footer"
        if name == "aside":
            return "sidebar"
        if name in ("main", "article"):
            return "main"
        if name == "header":
            return "navigation"
        marks = " ".join([*(parent.get("class") or []), parent.get("id") or "", parent.get("role") or ""]).lower()
        if any(w in marks for w in ("footer", "colophon")):
            return "footer"
        if any(w in marks for w in ("sidebar", "widget")):
            return "sidebar"
        if any(w in marks for w in ("menu", "navbar", "nav-")):
            return "navigation"
        if any(w in marks for w in ("content", "post", "entry", "article")):
            return "main"
    return "unknown"


def _anchor(a: Tag) -> tuple[str | None, str]:
    text = " ".join(a.get_text(" ", strip=True).split())
    if text:
        return text[:MAX_ANCHOR], "text"
    img = a.find("img")
    if img is not None:
        return (" ".join((img.get("alt") or "").split())[:MAX_ANCHOR] or None), "image"
    return None, "other"


def extract_page(html: str, page_url: str, with_context: bool = False) -> PageExtract:
    """Parse `html` fetched from `page_url`. Honours <base href>; skips non-http(s) and fragment-only links."""
    soup = BeautifulSoup(html or "", "html.parser")
    base = page_url
    base_tag = soup.find("base", href=True)
    if base_tag:
        base = urljoin(page_url, base_tag["href"])
    try:
        page_domain = registrable_domain(normalize_url(page_url).split("/")[2].split(":")[0])
    except (ValueError, IndexError):
        page_domain = ""
    title = soup.title.get_text(strip=True)[:500] if soup.title and soup.title.string is not None else None
    canon = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    robots = soup.find("meta", attrs={"name": lambda v: v and v.lower() == "robots"})

    links: list[ExtractedLink] = []
    seen: dict[str, int] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.lower().startswith(_SKIP_SCHEMES):
            continue
        try:
            target = normalize_url(urljoin(base, href))
        except ValueError:
            continue
        rel = sorted({r.lower() for r in (a.get("rel") or [])} & _REL_KEEP)
        anchor, ltype = _anchor(a)
        instance = seen.get(target, 0)
        seen[target] = instance + 1
        host_domain = registrable_domain(target.split("/")[2].split(":")[0])
        ctx = None
        if with_context and a.parent is not None:
            ctx = " ".join(a.parent.get_text(" ", strip=True).split())[:300]
        links.append(ExtractedLink(target, anchor, rel, ltype, _placement(a), host_domain == page_domain, instance, ctx))
    desc = soup.find("meta", attrs={"name": lambda v: v and v.lower() == "description"}) or soup.find("meta", attrs={"property": "og:description"})
    snippet = " ".join(((desc.get("content") if desc is not None else "") or "").split())
    if len(snippet) < 60:  # no usable description: fall back to the start of the visible text
        for t in soup(["script", "style", "noscript", "nav", "header", "footer"]):
            t.decompose()
        snippet = " ".join((snippet + " " + soup.get_text(" ", strip=True)).split())
    return PageExtract(title, snippet[:600] or None, urljoin(base, canon["href"]) if canon and canon.get("href") else None,
                       robots["content"] if robots and robots.get("content") else None, links, base)
