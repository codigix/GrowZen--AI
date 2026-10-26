"""Password hashing: salted scrypt (standard library), stored as scrypt$<salt>$<hash>."""
import hashlib
import hmac
import secrets

_N, _R, _P = 16384, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=_N, r=_R, p=_P, dklen=64).hex()
    return f"scrypt${salt}${digest}"


def verify_password(password: str, stored: str | None) -> bool:
    try:
        scheme, salt, digest = (stored or "").split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=salt.encode(), n=_N, r=_R, p=_P, dklen=64).hex()
    return hmac.compare_digest(candidate, digest)
