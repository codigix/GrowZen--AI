"""Who may use a connected Google account. GoogleConnection.connected_by is "user <User.id>" (set at connect time), so a connection
belongs to the account that connected it; admins can use all of them. Another user's Search Console / Analytics / Business Profile
account is never listed, linked or queried."""
from fastapi import HTTPException

from .auth import User
from .models import GoogleConnection


def owns_connection(user: User, c: GoogleConnection | None) -> bool:
    return c is not None and (user.sees_all or c.connected_by == f"user {user.id}" or bool(user.email and (c.email or "").lower() == user.email.strip().lower()))


def only_my_connections(stmt, user: User):
    if user.sees_all:
        return stmt
    from sqlalchemy import func, or_
    return stmt.where(or_(GoogleConnection.connected_by == f"user {user.id}", func.lower(GoogleConnection.email) == (user.email or "-").strip().lower()))


def my_connection(db, user: User, connection_id: int | None) -> GoogleConnection:
    c = db.get(GoogleConnection, connection_id) if connection_id else None
    if not owns_connection(user, c):
        raise HTTPException(404, "Connection not found")
    return c
