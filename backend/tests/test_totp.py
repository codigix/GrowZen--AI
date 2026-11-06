"""RFC 6238 test vectors (SHA-1, secret "12345678901234567890", 8 digits in the RFC; the same HMAC truncated to 6 digits here)."""
import base64

from app.services import totp

SECRET = base64.b32encode(b"12345678901234567890").decode()


def test_rfc6238_vectors():
    for t, eight in [(59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"), (1234567890, "89005924"), (2000000000, "69279037"), (20000000000, "65353130")]:
        assert totp.code_at(SECRET, t // 30, digits=8) == eight
        assert totp.code_at(SECRET, t // 30) == eight[-6:]


def test_verify_accepts_one_step_of_drift_and_nothing_else():
    now = 1111111109
    step = totp.current_step(now)
    assert totp.verify(SECRET, totp.code_at(SECRET, step), now) == step
    assert totp.verify(SECRET, totp.code_at(SECRET, step - 1), now) == step - 1
    assert totp.verify(SECRET, totp.code_at(SECRET, step + 1), now) == step + 1
    assert totp.verify(SECRET, totp.code_at(SECRET, step + 3), now) is None
    assert totp.verify(SECRET, "12345", now) is None and totp.verify(SECRET, "", now) is None and totp.verify(SECRET, "abcdef", now) is None
    assert totp.verify(SECRET, " " + totp.code_at(SECRET, step)[:3] + " " + totp.code_at(SECRET, step)[3:], now) == step  # pasted with a space


def test_secret_and_uri():
    s = totp.new_secret()
    assert len(s) == 32 and totp.now_code(s).isdigit()
    uri = totp.otpauth_uri(s, "a@b.in")
    assert uri.startswith("otpauth://totp/Bevisiby%20SEO:a%40b.in?secret=" + s)
