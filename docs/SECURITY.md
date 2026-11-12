# Security settings

What the server enforces, where, and what you must still do yourself.

## Enforced by the code

| Area | What happens | Where |
|---|---|---|
| Response headers | Every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment off), `Cross-Origin-Opener-Policy: same-origin`. `Strict-Transport-Security` over https. | `app/security_headers.py` |
| Content-Security-Policy | JSON/API: `default-src 'none'; frame-ancestors 'none'`. The served web app: own scripts and styles only, Google Fonts, images over https/data/blob, `connect-src 'self'`, no `unsafe-eval`, no framing. HTML reports made by the API keep their own scripts but cannot be framed. | same |
| API docs | `/docs`, `/redoc`, `/openapi.json` are off when `ENVIRONMENT=production`. | `docs_kwargs` |
| Cross-site requests | A POST/PUT/PATCH/DELETE whose `Origin` (or `Referer`) is neither this site nor a `CORS_ORIGINS` / `FRONTEND_URL` / `PUBLIC_BASE_URL` address gets 403. Public routes with their own token are exempt (`/intake/webhook`, `/public/review/*`). Switch off with `CSRF_ORIGIN_CHECK=false` (not recommended). | `OriginCheckMiddleware` |
| Start-up | The server will not start with `SECRET_KEY` missing, `change-me` or under 32 characters (only `ALLOW_INSECURE_DEV=true` skips this), with `*` in `CORS_ORIGINS`, or with stored Google connections and a missing/invalid `TOKEN_ENCRYPTION_KEY`. A `.env` readable by other users (Linux/macOS) logs a warning. | `startup_checks`, `check_encryption_key` |
| Sign-in | Wrong passwords are counted per account + address (5), per address (20) and per account (10); the lockout lasts 15 minutes and also blocks the right password. An unknown email gets the same answer, the same lockout and the same work (a hash is always checked). Every sign-in and failure is written to the activity log with the address (never the password). Settings: `LOGIN_MAX_FAILURES`, `LOGIN_IP_MAX_FAILURES`, `LOGIN_ACCOUNT_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`. | `routers/auth.py` |
| Passwords | At least 10 characters, not on a list of common passwords, not only digits or one repeated character, not the email or its name with digits added, not the published default. Applies to create, admin change, own change and reset. Stored as salted scrypt (N=16384, r=8, p=1). | `validate_password`, `services/passwords.py` |
| Sessions | Cookie `seo_session`: HttpOnly, SameSite=Lax, `Secure` when `PUBLIC_BASE_URL`, `FRONTEND_URL` or `COOKIE_SECURE` is https. Lifetime `SESSION_HOURS` (default 12). The session carries a fingerprint of the password: a password change or reset ends every other session of the account (the one that changed it is re-issued). Old-format sessions are refused. Logout clears both cookies. | `app/auth.py` |
| Project cookie | `seo_project` (the two-step project claim): HttpOnly, SameSite=Strict, 8 hours. | `app/auth.py` |
| Password reset | `/auth/forgot-password` answers the same for every email and never returns the token: it goes to the mailbox only, is valid for one hour, works once, and is rate-limited. Without SMTP the request is logged and an admin sets the password under Users. | `routers/auth.py` |
| Stored secrets | Google refresh tokens and authenticator secrets are encrypted with `TOKEN_ENCRYPTION_KEY` (Fernet). `.env` is git-ignored. API keys are not logged (httpx logging is off because PageSpeed takes its key in the URL). The generated first-start admin password is printed once to the log if `ADMIN_PASSWORD` is not set. | `services/crypto.py`, `main.py` |
| Public endpoints | `/public/review/*`: signed token, 15 suggestions per 10 minutes per address. `/intake/webhook`: constant-time token check. | `routers/review_link.py`, `routers/intake.py` |

## Why SameSite=Lax and not Strict for the session

The sign-in cookie must survive the redirect back from Google (a cross-site navigation). With Strict it would be dropped on that first request. Cross-site POSTs are blocked separately by the origin check above.

## Behind a proxy

The server sees the proxy's address, not the visitor's, unless `TRUST_PROXY_HEADERS=true` (then the first `X-Forwarded-For` entry is used). Turn that on only behind a proxy you control, and make the proxy set the header (Vite dev proxy: `xfwd: true`). Without it, all visitors share one address in the per-address lockout.

## You still have to

- Use https in production (`PUBLIC_BASE_URL` and `FRONTEND_URL` as https addresses) so cookies get `Secure` and HSTS is sent.
- Set `ENVIRONMENT=production` on the server (turns off the API docs).
- Rotate the Gmail App Password in `.env` if it was ever shared in chat or a ticket.
- Keep `.env` private (`chmod 600` on Linux) and never commit it.
- Back up `TOKEN_ENCRYPTION_KEY`: a new key cannot decrypt the stored Google connections.
- Change `ADMIN_PASSWORD` after the first sign-in.
