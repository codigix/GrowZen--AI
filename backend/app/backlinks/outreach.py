"""Drafts a polite link-removal request for one referring domain. Grounded only in the links our bot found; a person reads and sends it.

With an AI key configured the wording is written by the model; otherwise (or if the AI is down) a plain template is used, so the feature
never depends on a vendor being up. Nothing is sent from here."""
import logging

from ..services import ai

log = logging.getLogger("seo.backlinks.outreach")

SYSTEM = ai.RULES + """
You write short, courteous emails asking a website owner to remove or nofollow links to the sender's site.
- 90 to 150 words. Plain text, no markdown. Greet them, state the facts, make one clear request, thank them, sign with the sender name.
- List the exact linking pages and targets you are given. Do not invent contact names, reasons, laws, deadlines or threats.
- You do not know the sender's personal name: never write "My name is". Open with "I am writing on behalf of <business>".
- Do NOT say who placed the links, that they were unauthorised or unrequested, or that they harm the sender: you do not know that. Simply say the sender found the links and would like them removed or changed to nofollow.
- Return JSON: {"subject": "...", "body": "..."}"""


def template(business: str, source_domain: str, target_domain: str, links: list[dict]) -> dict:
    lines = "\n".join(f"- {x['source_url']}  ->  {x['target_url']}" + (f'  (anchor: "{x["anchor_text"]}")' if x.get("anchor_text") else "") for x in links)
    body = (f"Hello,\n\nI am writing on behalf of {business}. While reviewing who links to {target_domain}, we found {len(links)} link{'s' if len(links) != 1 else ''} "
            f"from {source_domain} pointing to our site:\n\n{lines}\n\n"
            f"We would like {'these links' if len(links) != 1 else 'this link'} removed. Could you please remove {'them' if len(links) != 1 else 'it'}, or change {'them' if len(links) != 1 else 'it'} to nofollow? "
            f"If you would like to talk about it first, just reply to this email.\n\nThank you for your time.\n\nKind regards,\n{business}")
    return {"subject": f"Request to remove links to {target_domain} from {source_domain}", "body": body, "source": "template"}


def draft_removal_email(business: str, source_domain: str, target_domain: str, links: list[dict]) -> dict:
    fallback = template(business, source_domain, target_domain, links)
    if not ai.is_configured():
        return fallback
    facts = "\n".join(f"- {x['source_url']} -> {x['target_url']}" + (f" (anchor: {x['anchor_text']})" if x.get("anchor_text") else "") for x in links)
    user = f"Sender: {business}\nSender's website: {target_domain}\nLinking website: {source_domain}\nLinks found:\n{facts}"
    try:
        out = ai.complete_json(SYSTEM, user, temperature=0.4, max_tokens=700)
        subject, body = str(out.get("subject", "")).strip(), str(out.get("body", "")).strip()
        if subject and body and "my name is" not in body.lower() and all(x["source_url"] in body for x in links[:3]):  # the draft must actually name the pages
            return {"subject": subject[:200], "body": body, "source": "ai"}
    except (ai.AiUnavailable, ValueError) as exc:
        log.warning("AI removal draft failed, using the template: %s", exc)
    return fallback
