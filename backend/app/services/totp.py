"""Time-based one-time passwords (RFC 6238, what Google Authenticator and every authenticator app speak). Standard library only.

A code is 6 digits from HMAC-SHA1 over the 30-second step counter. `verify` accepts the previous, current and next step (clock drift) and
returns the matched step, so the caller can refuse the same code twice (a code is single-use)."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6


def new_secret() -> str:
    """A random 160-bit secret as base32 (what authenticator apps take as the manual key)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    s = secret.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def code_at(secret: str, step: int, digits: int = DIGITS, algo=hashlib.sha1) -> str:
    mac = hmac.new(_key(secret), struct.pack(">Q", step), algo).digest()
    off = mac[-1] & 0x0F
    n = (struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(n).zfill(digits)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP)


def now_code(secret: str) -> str:
    return code_at(secret, current_step())


def verify(secret: str, code: str, now: float | None = None, window: int = 1) -> int | None:
    """The step the code belongs to (previous, current or next), or None when it is wrong. Constant-time comparison."""
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != DIGITS:
        return None
    base = current_step(now)
    hit = None
    for step in range(base - window, base + window + 1):
        if hmac.compare_digest(code_at(secret, step), code):
            hit = step
    return hit


def otpauth_uri(secret: str, account: str, issuer: str = "Bevisiby SEO") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP}"


def qr_data_uri(text: str) -> str | None:
    """The otpauth link as an inline SVG QR code, or None when the `segno` package is not installed (the manual key still works)."""
    try:
        import io
        import segno
    except ImportError:
        return None
    buf = io.BytesIO()
    segno.make(text, error="m").save(buf, kind="svg", scale=5, border=2, dark="#0f172a")
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()
