"""Encrypt stored secrets (Google refresh tokens) with Fernet."""
from cryptography.fernet import Fernet, InvalidToken

from ..config import get_settings


def _fernet() -> Fernet:
    key = get_settings().token_encryption_key
    if not key:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY is not set. Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
    return Fernet(key.encode())


def seal(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Stored token cannot be decrypted (TOKEN_ENCRYPTION_KEY changed?)") from exc
