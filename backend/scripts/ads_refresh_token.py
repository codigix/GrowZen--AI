"""One-time helper: create the Google Ads refresh token for Keyword Planner.

Run from the backend folder, after GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env are the
`bevisibe web` client's values:

    .venv\\Scripts\\python.exe scripts\\ads_refresh_token.py

It opens Google's sign-in. Sign in with the Google account that can open the Google Ads account, allow access,
and the refresh token is printed here. Copy it into GOOGLE_ADS_REFRESH_TOKEN in .env, then delete this file's output
from your terminal history. The client secret is never printed.

The redirect URI http://localhost:8080/ must be listed under Authorized redirect URIs of the OAuth client.
"""
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402

PORT = 8080
REDIRECT = f"http://localhost:{PORT}/"
SCOPE = "https://www.googleapis.com/auth/adwords"


def main() -> None:
    s = get_settings()
    if not (s.google_ads_client_id and s.google_ads_client_secret):
        sys.exit("Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in backend/.env first (check the variable names).")

    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": s.google_ads_client_id, "redirect_uri": REDIRECT, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent"})
    got: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = parse_qs(urlparse(self.path).query)
            got["code"] = (q.get("code") or [""])[0]
            got["error"] = (q.get("error") or [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Done. You can close this tab and go back to the terminal.")

        def log_message(self, *a):
            pass

    print("Opening Google sign-in. If the browser does not open, copy this link:\n" + url + "\n")
    webbrowser.open(url)
    HTTPServer(("localhost", PORT), Handler).handle_request()
    if not got.get("code"):
        sys.exit(f"No code received ({got.get('error') or 'cancelled'}).")

    r = httpx.post("https://oauth2.googleapis.com/token", data={
        "code": got["code"], "client_id": s.google_ads_client_id, "client_secret": s.google_ads_client_secret,
        "redirect_uri": REDIRECT, "grant_type": "authorization_code"}, timeout=30)
    body = r.json()
    if r.status_code != 200 or not body.get("refresh_token"):
        sys.exit(f"Google did not return a refresh token: {body.get('error_description') or body.get('error') or r.text[:200]}")
    print("Granted scope:", body.get("scope"))
    print("\nGOOGLE_ADS_REFRESH_TOKEN=" + body["refresh_token"])


if __name__ == "__main__":
    main()
