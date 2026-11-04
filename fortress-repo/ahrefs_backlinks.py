"""Look up a domain on the Ahrefs free Backlink Checker through Fortress.

Usage:
    .venv\\Scripts\\python ahrefs_backlinks.py codigix.co [--mode subdomains] [--show]

Prints JSON: domain rating, backlinks, linking websites and the referring-pages table.
"""
import argparse, json, re, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = Path(__file__).parent
# Engine and profile both live inside this folder, not ~/.cache.
CHROME = HERE / "browsers" / "153.0.8010.36" / "win-x64" / "fortress-v153-win-x64" / "chrome.exe"
PROFILES = HERE / "browsers" / "profiles"
URL = "https://ahrefs.com/backlink-checker/?input={domain}&mode={mode}"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def fortress(headless: bool = True, wait_s: int = 120):
    """Launch the Fortress engine directly and yield its CDP URL.

    The SDK's launcher goes through tillion.cmd, gives up after 40s (too short for a
    first launch on Windows) and then kills only the cmd wrapper, orphaning chrome.exe.
    """
    # Each run gets its own throwaway profile. A shared one is locked by whichever chrome.exe
    # holds it, so a second run (or a leftover from Ctrl+C) makes the new browser hand off and exit.
    PROFILES.mkdir(parents=True, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="run-", dir=PROFILES)
    port = _free_port()
    args = [str(CHROME), f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
            "--uxr-webrtc-policy=disable_non_proxied_udp", "--no-first-run"]  # tillion.cmd default
    if headless:
        args += ["--headless=new", "--no-sandbox"]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + wait_s
        while True:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2).read()
                break
            except OSError:
                if proc.poll() is not None or time.time() > deadline:
                    raise RuntimeError(f"Fortress did not open its CDP port {port}")
                time.sleep(0.5)
        yield f"http://127.0.0.1:{port}"
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Child processes can hold profile files for a moment after taskkill.
        for _ in range(10):
            shutil.rmtree(profile, ignore_errors=True)
            if not Path(profile).exists():
                break
            time.sleep(0.5)


LABELS = ["Domain Rating", "URL Rating", "Backlinks", "Linking websites", "DR"]


def _metric(text: str, label: str):
    """Pull '<label> <value> [<n>% dofollow]' out of the modal's text."""
    start = text.find(label)
    if start < 0:
        return None
    chunk = text[start + len(label):start + len(label) + 120]
    # Stop at the next metric so one card's numbers don't leak into another's.
    ends = [i for i in (chunk.find(l) for l in LABELS) if i > 0]
    chunk = chunk[:min(ends)] if ends else chunk
    v = re.search(r"\b(\d[\d.,]*\s*[KMB]?)(?![\d%])", chunk)
    if not v:
        return None
    d = re.search(r"(\d+%)\s*dofollow", chunk)
    return {"value": v.group(1).strip(), "dofollow": d.group(1) if d else None}


def normalize(domain: str) -> str:
    """'https://www.codigix.co/about' -> 'codigix.co'."""
    d = re.sub(r"^[a-z]+://", "", domain.strip().lower())
    d = d.split("/")[0].split("?")[0]
    return d[4:] if d.startswith("www.") else d


def scrape(domain: str, mode: str = "subdomains", headless: bool = True, timeout_s: int = 90) -> dict:
    domain = normalize(domain)
    if "." not in domain:
        raise ValueError(f"'{domain}' is not a domain; include the TLD, e.g. {domain}.co")
    with fortress(headless) as cdp_url, sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()
        page.goto(URL.format(domain=domain, mode=mode), wait_until="domcontentloaded")

        # The ?input= link only prefills the box; submit it ourselves. Cloudflare Turnstile
        # can swallow the first click while it verifies, so re-click until the modal shows.
        button = page.get_by_role("button", name=re.compile("Check backlinks", re.I)).first
        heading = re.compile(rf"Backlink profile for\s+(?:www\.)?{re.escape(domain)}", re.I)
        deadline, next_click = time.time() + timeout_s, 0
        text, rows, metrics = "", [], {}
        while time.time() < deadline:
            page.wait_for_timeout(1000)
            body = page.inner_text("body")
            m = heading.search(body)
            i = m.start() if m else -1
            if i < 0:
                # Modal not open yet. Re-click only while it is closed: a second submit
                # after results load resets the modal and we'd read it mid-reload.
                if time.time() >= next_click:
                    try:
                        button.click(timeout=5000)
                    except PWTimeout:
                        pass
                    next_click = time.time() + 15
                continue
            # Only read metrics from the results modal; the page's marketing copy repeats the labels.
            text = body[i:]
            rows = _rows(page)
            metrics = {
                "domain_rating": (_metric(text, "Domain Rating") or {}).get("value"),
                "backlinks": _metric(text, "Backlinks"),
                "linking_websites": _metric(text, "Linking websites"),
            }
            # Done once numbers and table are both rendered (or Ahrefs says there's nothing).
            if (metrics["linking_websites"] and rows) or re.search(r"no backlinks|not found", text, re.I):
                break

        if not metrics.get("linking_websites"):
            shot = Path(__file__).parent / f"ahrefs_{domain}_fail.png"
            page.screenshot(path=str(shot), full_page=True)
            return {"domain": domain, "error": "results did not appear (captcha or layout change)",
                    "screenshot": str(shot), **metrics}

        return {"domain": domain, "mode": mode, **metrics, "referring_pages": rows}


def _rows(page) -> list:
    return page.evaluate("""() => {
            const out = [];
            for (const tr of document.querySelectorAll('table tbody tr')) {
                const td = tr.querySelectorAll('td');
                if (td.length < 3) continue;
                const a1 = [...td[1].querySelectorAll('a')];
                const lines = td[2].innerText.split('\\n').map(s => s.trim()).filter(Boolean);
                const isRedirect = l => /^\\d{3}\\s+https?:/.test(l);
                const isUrl = l => /^https?:/.test(l);
                out.push({
                    dr: td[0].innerText.trim(),
                    referring_page_title: a1[0] ? a1[0].innerText.trim() : td[1].innerText.trim(),
                    referring_page_url: a1.length ? a1[a1.length - 1].href : null,
                    anchor_text: lines.filter(l => !isUrl(l) && !isRedirect(l)).join(' '),
                    target_url: lines.find(isUrl) || null,
                    redirects: lines.filter(isRedirect),
                });
            }
            return out;
        }""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("domain")
    ap.add_argument("--mode", default="subdomains", choices=["subdomains", "exact", "prefix", "domain"])
    ap.add_argument("--show", action="store_true", help="show the browser window")
    a = ap.parse_args()
    result = scrape(a.domain, a.mode, headless=not a.show)
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
