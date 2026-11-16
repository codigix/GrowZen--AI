"""The Google account and Search Console property a project may read: the account linked to it, nothing else (another project's account is never tried)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GoogleConnection
from . import gsc
from .gbp import GbpError


def find_owner(db: Session, b: Business, host: str) -> GoogleConnection | None:
    """A project with no linked account: the connected account that owns this site's Search Console property, if there is one. Having the
    verified property proves the account belongs to this site, so it is linked to the project and used from then on."""
    for c in db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active", GoogleConnection.refresh_token_enc.is_not(None), GoogleConnection.connected_by == f"user {b.owner_id}").order_by(GoogleConnection.id)):
        if not gsc.has_scope(c):
            continue
        try:
            if gsc.match_property(gsc.SearchConsole(c).sites(), host):
                b.connection_id = c.id
                db.commit()
                return c
        except GbpError:
            continue
    return None


def own_connections(db: Session, b: Business, only: int | None = None, host: str | None = None) -> list[GoogleConnection]:
    pick = only or b.connection_id
    if not pick and host:
        owner = find_owner(db, b, host)
        return [owner] if owner else []
    if not pick:
        return []
    c = db.get(GoogleConnection, pick)
    if c and pick != b.connection_id and c.connected_by != f"user {b.owner_id}":
        return []  # an account the project is not linked to is never used for it
    return [c] if c and c.status == "active" and c.refresh_token_enc else []


def search_console(db: Session, b: Business, host: str):
    """(state, message, SearchConsole, property) for the business's site, from a connected Google account that can see it."""
    conns = [c for c in own_connections(db, b, host=host) if gsc.has_scope(c)]
    if not conns:
        linked = db.get(GoogleConnection, b.connection_id) if b.connection_id else None
        if linked and linked.status != "active":
            return "not_connected", f"The Google account linked to this project ({linked.email}) is disconnected. Reconnect it in Integrations.", None, None
        return "not_connected", "No Google account is linked to this project. Connect the account that owns this site in Search Console (Integrations) and link it to the project.", None, None
    notes: list[str] = []
    for conn in conns:
        try:
            sc = gsc.SearchConsole(conn)
            sites = sc.sites()
            site = gsc.match_property(sites, host)
        except GbpError as exc:
            notes.append(f"{conn.email}: {str(exc)[:160]}")
            continue
        if site:
            return "ok", conn.email, sc, site
        have = [x["siteUrl"] for x in sites if x.get("permissionLevel") != "siteUnverifiedUser"]
        unverified = [x["siteUrl"] for x in sites if x.get("permissionLevel") == "siteUnverifiedUser" and host in x["siteUrl"]]
        if unverified:
            notes.append(f"{conn.email} is listed on {unverified[0]} only as an unverified user, and Google returns no data at that level. Ask the site's owner to add it as a Full user in Search Console.")
            continue
        notes.append(f"{conn.email} has no verified property for {host}" + (f" (it has: {', '.join(have[:6])}{'…' if len(have) > 6 else ''})." if have else " (it has no verified properties at all)."))
    msg = " ".join(notes) or "No verified Search Console property for this site."
    return "no_property", msg + " Add and verify the site in Search Console, or link the account that owns it to this project.", None, None
