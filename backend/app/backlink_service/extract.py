import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .urls import normalize_url

# href="..." written inside JavaScript strings (HTML templates that scripts insert later), quotes may be escaped
_SCRIPT_HREF_RE = re.compile(r"""href\s*=\s*\\{0,2}["']([^"'\\\s<>]+)""", re.I)
_TAG_RE = re.compile(r"<[^>]*>")


@dataclass
class Link:
    url: str
    anchor: str = ""
    rel: list[str] = field(default_factory=list)
    context: str = ""
    found_in: str = "html"  # html | script
    tag: Any = field(default=None, repr=False, compare=False)  # the <a> element: its context is only read for links that match a target

    def get_context(self) -> str:
        """Text around the link. Computed on demand: for every link of a big page it cost more than everything else together."""
        if not self.context and self.tag is not None:
            self.context = _context_around(self.tag, self.anchor)
        return self.context


@dataclass
class ParsedPage:
    url: str
    title: str = ""
    nofollow: bool = False
    links: list[Link] = field(default_factory=list)


def _anchor_text(a) -> str:
    text = a.get_text(" ", strip=True)
    if not text:
        img = a.find("img", alt=True)
        text = (img["alt"].strip() if img else "") or (a.get("title") or "").strip()
    return text[:200]


def _context_around(anchor_tag, anchor_text: str, width: int = 140) -> str:
    """Readable sentence around a link, e.g. 'Website Designed by Codigix infotech Pvt Ltd'."""
    parent = anchor_tag.parent
    text = parent.get_text(" ", strip=True) if parent else ""
    if len(text) <= 2 * width:
        return text
    i = text.find(anchor_text) if anchor_text else -1
    if i < 0:
        return text[:2 * width]
    return text[max(0, i - width): i + len(anchor_text) + width]


def _script_link(script_text: str, pos: int) -> tuple[str, list[str], str]:
    """(anchor text, rel, context) of the <a ...>...</a> template a script string href belongs to."""
    start = script_text.rfind("<a", max(0, pos - 300), pos)
    end = script_text.find("</a>", pos, pos + 1500)
    if start < 0 or end < 0:
        return "", [], ""
    fragment = (script_text[start:end + 4].replace('\\"', '"').replace("\\'", "'")
                .replace("\\n", " ").replace("\\/", "/"))
    a = BeautifulSoup(fragment, "html.parser").find("a")
    if a is None:
        return "", [], ""
    before = _TAG_RE.sub(" ", script_text[max(0, start - 200):start].replace("\\n", " "))
    context = " ".join(f"{before} {a.get_text(' ', strip=True)}".split())[-280:]
    return _anchor_text(a), [r.lower() for r in (a.get("rel") or [])], context


def parse_page(url: str, html: str, header_nofollow: bool = False) -> ParsedPage:
    """Every outgoing link of a page: <a href> plus href strings inside inline scripts."""
    soup = BeautifulSoup(html, "html.parser")
    base_tag = soup.find("base", href=True)
    base = urljoin(url, base_tag["href"]) if base_tag else url
    page = ParsedPage(url=url, nofollow=header_nofollow)
    meta = soup.find("meta", attrs={"name": lambda n: n and n.lower() == "robots"})
    if meta and "nofollow" in (meta.get("content") or "").lower():
        page.nofollow = True
    page.title = soup.title.get_text(" ", strip=True)[:200] if soup.title else ""

    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        target = normalize_url(a["href"], base)
        if target is None:
            continue
        anchor = _anchor_text(a)
        page.links.append(Link(target, anchor, [r.lower() for r in (a.get("rel") or [])], tag=a))
        seen.add(target)
    for script in soup.find_all("script"):
        text = script.string
        if script.get("src") or not text:
            continue
        for m in _SCRIPT_HREF_RE.finditer(text):
            target = normalize_url(m.group(1).replace("\\/", "/"), base)
            if target and target not in seen:
                seen.add(target)
                anchor, rel, context = _script_link(text, m.start())
                page.links.append(Link(target, anchor, rel, context, "script"))
    return page
