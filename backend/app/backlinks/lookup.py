"""Search the backlinks already stored in the database by a domain, a URL or just a word, with fuzzy matching.

Nothing is crawled here: this only reads what the discovery bot has stored. Works the same on SQLite and PostgreSQL (no database extension needed).

How a query is read:
- A word or domain (`codigix`, `codigix.co`, `www.codigix.co`) is matched against the domains in the business's backlink data. A domain scores
  100 when it equals the query, 92-97 when it contains it (`codigix` finds `codigix.co`, `codigixinfotech.com`, `blog.codigix.co`), and up to 89
  for a near match that tolerates typos (`codigx` finds `codigix.co`). Matches below `MIN_SCORE` are dropped.
- A URL with a path (`https://codigix.co/blog`) is matched as text against the stored target and source URLs.
- The word is also looked for in anchor text, and in the source and target URLs.
Both sides are searched: links pointing at a matching domain (`inbound`, listed first) and links coming from one (`outbound`).
An empty query or `*` lists every backlink in the table."""
from dataclasses import dataclass
from urllib.parse import urlsplit

MIN_TERM = 2
MAX_LIMIT = 5000  # most results one call may return
MIN_SCORE = 70  # how close a domain must be to the query to count (100 = exact; 70 tolerates a typo)
MAX_MATCHED_DOMAINS = 500  # a very short query can match thousands of domains; keep the best ones


@dataclass
class ParsedQuery:
    raw: str
    term: str  # lower-cased host or word, no scheme, no "www."
    path: str  # URL path after the host ("" for a plain word or a bare domain)
    kind: str  # "word" | "domain" | "url"
    phrase: str = ""  # the query as typed (lower-cased, spaces kept): what anchor text is searched for


def parse_query(raw: str) -> ParsedQuery:
    q = (raw or "").strip().lower()
    if not q:
        raise ValueError("Enter a domain, URL or word to search for")
    has_scheme = "://" in q
    parts = urlsplit(q if has_scheme else f"//{q}")  # "//codigix.co/blog" parses with codigix.co as the host
    host = (parts.hostname or "").strip(".") if (has_scheme or "." in q.split("/")[0]) else ""
    if host:
        term = host[4:] if host.startswith("www.") else host
        path = parts.path.rstrip("/")
        if parts.query:
            path += "?" + parts.query
        return ParsedQuery(raw.strip(), term, path, "url" if path else "domain", term)
    return ParsedQuery(raw.strip(), q.replace(" ", ""), "", "word", " ".join(q.split()))


def _trigrams(s: str) -> set[str]:
    return {s[i:i + 3] for i in range(len(s) - 2)}


def score_domain(term: str, domain: str) -> int:
    """0-100: how well `domain` (e.g. codigix.co) matches the query term. 0 means no match."""
    if not term or not domain:
        return 0
    label = domain.split(".")[0]
    if term in (domain, label):
        return 100
    if label.startswith(term) or domain.startswith(term):
        return 97
    if term in domain:
        return 92
    if len(term) < 4:  # too short for a typo-tolerant match: only exact and contains count
        return 0
    from difflib import SequenceMatcher
    needle = term.split(".")[0] if "." in term else term
    grams = _trigrams(needle)
    near = 100 * len(grams & _trigrams(label)) / len(grams) if grams else 0.0  # share of the query's 3-letter chunks that the domain has
    similar = 100 * SequenceMatcher(None, needle, label).ratio()  # whole-word similarity (catches a swapped or missing letter)
    return min(89, int(max(near, similar)))


def match_domains(term: str, domains: set[str] | list[str], min_score: int) -> dict[str, int]:
    """The best-scoring domains for `term` (at most MAX_MATCHED_DOMAINS), as {domain: score}."""
    scored = ((d, score_domain(term, d)) for d in domains)
    hits = sorted(((d, s) for d, s in scored if s >= min_score), key=lambda x: (-x[1], x[0]))
    return dict(hits[:MAX_MATCHED_DOMAINS])


def like_pattern(text: str) -> str:
    """A LIKE pattern meaning "contains `text`", with % and _ taken literally (use with escape="\\")."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
