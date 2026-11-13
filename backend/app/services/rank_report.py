"""Rank report: for every tracked keyword, where the site stands on Google, which page ranks, who is ahead, and what to do
to move up. Built only from saved data: the rank log (Search Console checks), the tracked keywords and the latest on-page crawl.
Advice is rule-based and always says why, so each line can be checked against the page."""
import re
from urllib.parse import urlparse

FEATURE_FAQ = ("people also ask", "featured snippet", "faq")


def _path(url: str | None) -> str:
    p = urlparse(url if (url or "").startswith("http") else f"https://{url or ''}").path or "/"
    return p if p == "/" else p.rstrip("/")


def _words(s: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 2}


def _covers(text: str | None, keyword: str) -> bool:
    """Most of the keyword's words are in the text (so "ent doctor in pune" is covered by "Best ENT Doctor Pune")."""
    k = _words(keyword)
    return bool(k) and len(k & _words(text)) / len(k) >= 0.75


def advice(row: dict, page: dict | None) -> list[dict]:
    """Ordered actions for one keyword. Each: {level: fix|improve|keep, text}."""
    out: list[dict] = []
    rank, prev, kw = row["rank"], row["prev_rank"], row["keyword"]

    def add(level: str, text: str) -> None:
        out.append({"level": level, "text": text})

    if row["pages_ranking"] > 1:
        add("fix", f"{row['pages_ranking']} pages of your site compete for \"{kw}\". Keep one page for it, merge the others into it and 301-redirect them.")

    if rank is None:
        if not row["url"] and not row["target_url"]:
            add("fix", f"No page of yours is in Google's top 20 for \"{kw}\". Create a page focused on it: the keyword in the title, H1 and first paragraph, a booking or contact button, and an FAQ.")
        else:
            add("fix", f"Your page is not in the top 20 for \"{kw}\". Check it is indexed (search site:yourdomain.com/path) and rewrite it to answer this search directly.")
    elif rank <= 3:
        add("keep", f"Strong position (#{rank}). Protect it: refresh the page every few months, keep the facts current and keep earning reviews and links.")
    elif rank <= 10:
        add("improve", f"Page 1 but #{rank}. Small changes can reach the top 3: sharpen the title and H1 around \"{kw}\", add an FAQ section, and link to this page from related pages.")
    else:
        add("improve", f"Position #{rank} is on page 2. Make the page more complete than the ones above it (cover costs, process, who it is for, FAQs), and add internal links and local mentions.")

    if rank and prev and rank - prev >= 3:
        add("fix", f"Dropped {rank - prev} places since the last check (#{prev} to #{rank}). Review what changed on the page, and what the pages above it now offer.")

    if row["ahead"] and rank != 1:
        names = ", ".join(row["ahead"][:3])
        add("improve", f"Ahead of you: {names}. Open their pages for \"{kw}\" and note what they cover that yours does not (sections, prices, photos, reviews).")

    if page:
        if page.get("noindex"):
            add("fix", "This page is set to noindex, so Google will not rank it. Remove the noindex tag.")
        if page.get("status") and page["status"] >= 400:
            add("fix", f"This page returns HTTP {page['status']}. Fix the page or redirect it.")
        if not _covers(page.get("title"), kw):
            add("improve", f"Page title \"{(page.get('title') or 'missing')[:70]}\" does not contain \"{kw}\". Rewrite it, under 60 characters, with the keyword near the start.")
        if not _covers(page.get("h1"), kw):
            add("improve", f"The H1 \"{(page.get('h1') or 'missing')[:70]}\" does not match \"{kw}\". Make the main heading say it plainly.")
        if (page.get("words") or 0) < 600:
            add("improve", f"Only {page.get('words') or 0} words. Pages that rank for this kind of search usually explain much more: aim for 800+ useful words.")
        if (page.get("inbound") or 0) < 3:
            add("improve", f"Only {page.get('inbound') or 0} internal link(s) point to this page. Link to it from your home page, menu and 3 related pages.")
        if page.get("images_missing_alt"):
            add("improve", f"{page['images_missing_alt']} image(s) have no alt text. Describe them, using the keyword where it fits.")
        if not page.get("schema"):
            add("improve", "No structured data (schema). Add the right type (FAQPage, MedicalWebPage, LocalBusiness or Article).")
    elif row["url"] or row["target_url"]:
        add("improve", "This page was not in the latest site crawl. Run an on-page audit to get title, heading, content and link checks for it.")

    if any(f in (x or "").lower() for x in row["features"] for f in FEATURE_FAQ) and not any(any(f in (x or "").lower() for f in FEATURE_FAQ) for x in row["own_features"]):
        add("improve", "Google shows a snippet or \"People also ask\" box for this search and you are not in it. Add 4-6 short question-and-answer blocks (40-60 words each) and FAQ schema.")

    if row.get("volume") and rank and rank > 3 and row["volume"] >= 500:
        add("improve", f"This keyword has about {row['volume']:,} searches a month, so it is worth the effort. Reaching the top 3 could bring several times your current clicks.")

    return out


def report(logs: list, keywords: list, own_host: str, pages_by_path: dict[str, dict]) -> dict:
    """logs: KeywordRankLog rows (any order); keywords: tracked Keyword rows."""
    by_kw: dict[str, list] = {}
    for r in sorted(logs, key=lambda x: x.day):
        by_kw.setdefault(r.keyword, []).append(r)
    rows = []
    for k in keywords:
        h = by_kw.get(k.keyword, [])
        last = h[-1] if h else None
        prev_log = h[-2] if len(h) > 1 else None
        rank = last.rank if last else None
        prev = prev_log.rank if prev_log else k.prev_rank
        url = (last.url if last else None) or None
        serp = (last.serp if last else None) or []
        ahead = []
        for s in sorted(serp, key=lambda x: x.get("p") or 99):
            if s.get("d") and s["d"] != own_host and (rank is None or (s.get("p") or 99) < rank) and s["d"] not in ahead:
                ahead.append(s["d"])
        own = (last.own_urls if last else None) or []
        row = {
            "keyword": k.keyword, "checked": last.day.isoformat() if last else None, "rank": rank, "prev_rank": prev,
            "change": (prev - rank) if (rank and prev) else None,  # positive = moved up
            "url": url, "target_url": k.target_url, "volume": k.volume, "intent": k.intent, "tag": k.cluster,
            "pages_ranking": len({_path(u) for u in own}) if own else (1 if url else 0),
            "ahead": ahead[:5], "features": (last.features if last else None) or [], "own_features": (last.own_features if last else None) or [],
            "best": min((x.rank for x in h if x.rank), default=None),
        }
        page = pages_by_path.get(_path(url or k.target_url)) if (url or k.target_url) else None
        row["advice"] = advice(row, page) if last else [{"level": "fix", "text": "Not checked yet. Press \"Check positions now\" to get its Google position."}]
        row["page"] = {"title": page.get("title"), "words": page.get("words"), "inbound": page.get("inbound")} if page else None
        rows.append(row)
    rows.sort(key=lambda r: (r["rank"] is None, r["rank"] or 99))
    s = [r["rank"] for r in rows if r["rank"]]
    return {
        "rows": rows,
        "summary": {
            "tracked": len(rows), "ranking": len(s), "top3": sum(1 for x in s if x <= 3), "top10": sum(1 for x in s if x <= 10),
            "not_ranking": len(rows) - len(s), "avg_position": round(sum(s) / len(s), 1) if s else None,
            "improved": sum(1 for r in rows if (r["change"] or 0) > 0), "declined": sum(1 for r in rows if (r["change"] or 0) < 0),
        },
    }
