"""Does a suggested keyword really fit this business? Every keyword a source finds is checked against what is known about the business: what it sells, who it is for, where it works and
who its competitors are. A keyword that is another company's brand, another product or service, or another place is hidden with the reason (it stays under "Set aside" and can be put back).

Keywords that show what the business already says or ranks for (its website, its profile, its Search Console queries) are facts about the business, so they are never judged away.
Without an AI the check is skipped and nothing is hidden: the list is never thinned on a guess."""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Competitor, KeywordCandidate

log = logging.getLogger("seo.keyword_fit")

BATCH = 40
MAX_PER_RUN = 120
OWN_KINDS = {"website", "search_console", "profile"}


def _protected(r: KeywordCandidate) -> bool:
    return bool(r.picked or r.own_rank is not None or any(s.get("kind") in OWN_KINDS for s in r.sources or []))


def _context(db: Session, b: Business) -> str:
    from . import ai, business_understanding, market
    comps = [c.name for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).limit(8)) if c.selected is not False]
    lines = [ai.profile_text(b), business_understanding.prompt_block(b),
             f"Target area: {', '.join(market.places(b)[:6])}" if market.places(b) else "",
             f"Target audience: {b.target_audience}" if getattr(b, "target_audience", None) else "",
             f"Its competitors: {', '.join(comps)}" if comps else ""]
    return "\n".join(x for x in lines if x)


def judge(db: Session, b: Business, rows: list[KeywordCandidate]) -> dict[str, int]:
    """Check the rows that have not been checked. Returns how many were checked, kept as a good fit, and hidden."""
    from . import ai
    todo = [r for r in rows if r.fit is None and not _protected(r) and not r.dismissed][:MAX_PER_RUN]
    out = {"checked": 0, "fit": 0, "hidden": 0}
    if not todo or not ai.is_configured():
        return out
    ctx = _context(db, b)
    system = ("You decide which keywords a business should go after. Use ONLY the facts given. A keyword fits when a real customer of THIS business could type it and the business can serve "
              "that customer in its target area. It does not fit when it is another company's brand name, a different product or service, a different place from the target area, a job or "
              "support query, or too vague to mean anything. Reply with JSON only.")
    for start in range(0, len(todo), BATCH):
        batch = todo[start:start + BATCH]
        listing = [{"i": i, "keyword": r.keyword, "volume": r.volume, "found_by": sorted({s.get("kind") for s in r.sources or []}), "used_by_competitors": (r.competitors or [])[:2]} for i, r in enumerate(batch)]
        user = (f"The business:\n{ctx}\n\nKeywords to check:\n{json.dumps(listing, ensure_ascii=False)}\n\nFor each give fit: \"yes\" (clearly a customer of this business), \"maybe\" (could be, unclear) "
                "or \"no\" (see the rules), why (under 15 words, naming the deciding fact: the service, the brand, the place) and for (the customer or service it serves, 2 to 5 words, empty "
                'when fit is "no"). Answer exactly: {"results": [{"i": 0, "fit": "yes", "why": "", "for": ""}]}')
        try:
            data = ai.complete_json(system, user, temperature=0.1, max_tokens=min(4000, 90 * len(batch) + 300))
        except Exception as exc:  # noqa: BLE001 - an unchecked keyword stays in the list
            log.warning("Keyword fit check failed: %s", exc)
            continue
        for r_ in data.get("results") or []:
            try:
                row = batch[int(r_["i"])]
            except (KeyError, ValueError, TypeError, IndexError):
                continue
            verdict = str(r_.get("fit") or "").lower()
            if verdict not in ("yes", "maybe", "no"):
                continue
            row.fit = {"fit": verdict, "why": str(r_.get("why") or "")[:160], "for": str(r_.get("for") or "")[:60], "at": date.today().isoformat()}
            out["checked"] += 1
            if verdict == "no":
                row.dismissed = True
                row.fit["auto"] = True
                out["hidden"] += 1
            else:
                out["fit"] += 1
    db.flush()
    return out
