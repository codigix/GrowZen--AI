import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

URL = "https://dir.indiamart.com/impcat/kamdhenu-cow-and-calf-statue.html"
OUTPUT_FILE = Path.cwd() / "report.json"

# A regular desktop Chrome user agent (replaces "...HeadlessChrome" / "Chrome-Lighthouse").
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)

# Optional: if you own the site, add a WAF rule that allows requests carrying
# this header, then set AUDIT_TOKEN in your environment.
AUDIT_TOKEN = os.environ.get("AUDIT_TOKEN")


def preflight_check(url):
    """Make a plain request with the same user agent to see what status the server returns."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except Exception as exc:
        print(f"Preflight request failed: {exc}")
        return None


def build_command(lighthouse, headers_file):
    command = [
        lighthouse,
        URL,
        "--output=json",
        f"--output-path={OUTPUT_FILE}",
        "--preset=desktop",
        f"--emulated-user-agent={USER_AGENT}",
        "--chrome-flags=--headless=new",
        "--quiet",
    ]
    if headers_file:
        command.append(f"--extra-headers={headers_file}")
    return command


def run_lighthouse():
    lighthouse = shutil.which("lighthouse")
    if not lighthouse:
        print("Error: Lighthouse CLI was not found.")
        print("Install it with: npm install -g lighthouse")
        return 1

    print(f"Running Lighthouse audit for: {URL}")
    print("Device: Desktop")
    print(f"Report path: {OUTPUT_FILE}")

    status = preflight_check(URL)
    print(f"Preflight HTTP status: {status}")
    if status in (401, 403, 429):
        print(
            "Warning: the server is already rejecting plain requests, so "
            "Lighthouse will probably fail too (bot protection / WAF / rate limit)."
        )

    OUTPUT_FILE.unlink(missing_ok=True)

    # Extra headers must be passed to Lighthouse as a JSON file on Windows.
    headers_file = None
    if AUDIT_TOKEN:
        tmp = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        json.dump({"X-Audit-Token": AUDIT_TOKEN}, tmp)
        tmp.close()
        headers_file = tmp.name

    try:
        result = subprocess.run(
            build_command(lighthouse, headers_file),
            shell=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print("Error: Lighthouse timed out after 5 minutes.")
        return 1
    except OSError as exc:
        print(f"Error executing Lighthouse: {exc}")
        return 1
    finally:
        if headers_file:
            Path(headers_file).unlink(missing_ok=True)

    if not OUTPUT_FILE.exists():
        print("Error: Lighthouse did not generate report.json.")
        if result.stderr:
            print(result.stderr[-4000:])
        return 1

    try:
        with OUTPUT_FILE.open("r", encoding="utf-8") as file:
            report = json.load(file)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Error reading Lighthouse report: {exc}")
        return 1

    runtime_error = report.get("runtimeError")
    if runtime_error:
        code = runtime_error.get("code", "UNKNOWN_ERROR")
        message = runtime_error.get("message", "Lighthouse could not audit the page.")

        print("\nAudit failed.")
        print(f"Error code: {code}")
        print(f"Details: {message}")

        if "403" in message or code == "ERRORED_DOCUMENT_REQUEST":
            print(
                "\nThe site is still returning 403. Likely causes:\n"
                "  - A WAF/CDN bot rule (e.g. Cloudflare Bot Fight Mode) blocks automated traffic\n"
                "  - Your IP is rate-limited or flagged\n"
                "If you administer the site, allowlist your IP or add a rule that "
                "allows requests with the X-Audit-Token header, then set the "
                "AUDIT_TOKEN environment variable."
            )
        return 1

    categories = report.get("categories", {})
    if categories.get("performance", {}).get("score") is None:
        print("Error: No valid performance score was found in the report.")
        return 1

    print("\nLighthouse audit completed.")
    for category in ("performance", "accessibility", "best-practices", "seo"):
        score = categories.get(category, {}).get("score")
        if score is not None:
            print(f"{category.replace('-', ' ').title()}: {score * 100:.0f}/100")

    print(f"\nJSON report saved to: {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(run_lighthouse())