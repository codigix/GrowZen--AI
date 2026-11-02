"""Reads pages whose links only exist after JavaScript runs (React/Vue/Next shells) by loading them in headless Chrome and taking the finished DOM.

Safety, because a real browser runs the page's own scripts:
- The URL is validated first (SSRF guard: no private, loopback, link-local or metadata addresses) and Chrome is pinned to the validated IP, so a
  DNS change between the check and the load cannot reach an internal host.
- Every other hostname resolves to nothing (`MAP * ~NOTFOUND`), so scripts on the page cannot call internal services or third parties.
  Pages that need an outside CDN to render will come back unrendered; that is a deliberate trade for safety, and the plain-HTML result is kept.
- A fresh throw-away profile per page, a hard time limit, an output size cap, and at most two Chromes at once.
Rendering is slow (seconds per page), so it is opt-in per business and only used on pages that look like an unrendered app shell."""
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from bs4 import BeautifulSoup

from ..services.url_safety import SSRFValidationError, resolve_and_validate

log = logging.getLogger("seo.backlinks.renderer")
MAX_DOM_BYTES = 3 * 1024 * 1024
TIMEOUT_SECONDS = 30
VIRTUAL_TIME_MS = 7000  # how much page time (timers, fetches) Chrome lets JavaScript use before taking the DOM
_slots = threading.Semaphore(2)
_WINDOWS = (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")
_MOUNT_SELECTORS = ("#root", "#app", "#__next", "#__nuxt", "[data-reactroot]", "[ng-version]", "app-root")


class RenderError(RuntimeError):
    pass


def find_chrome() -> str | None:
    """CHROME_PATH if set, else a Chrome/Edge/Chromium on this machine."""
    env = os.environ.get("CHROME_PATH", "").strip()
    if env and Path(env).is_file():
        return env
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return next((p for p in _WINDOWS if Path(p).is_file()), None)


def available() -> bool:
    return find_chrome() is not None


def looks_js_rendered(html: str) -> bool:
    """True for an unrendered app shell: a mount node with next to no links, a page with almost no text but scripts, or a 'please enable JavaScript' notice."""
    soup = BeautifulSoup(html or "", "html.parser")
    links = sum(1 for a in soup.find_all("a", href=True) if not a["href"].startswith(("#", "javascript:", "mailto:", "tel:")))
    scripts = len(soup.find_all("script"))
    noscript = " ".join(n.get_text(" ", strip=True).lower() for n in soup.find_all("noscript"))
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    text_len = len(" ".join(soup.get_text(" ", strip=True).split()))
    has_mount = any(soup.select_one(sel) is not None for sel in _MOUNT_SELECTORS)
    return bool((has_mount and links <= 5 and text_len < 1500) or (text_len < 300 and scripts >= 2 and links <= 3)
                or ("javascript" in noscript and ("enable" in noscript or "required" in noscript) and links <= 5))


def build_command(chrome: str, url: str, host: str, ip: str, profile_dir: str, sandbox: bool = True) -> list[str]:
    cmd = [chrome, "--headless=new", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--mute-audio",
           "--no-first-run", "--hide-scrollbars", "--blink-settings=imagesEnabled=false", f"--user-data-dir={profile_dir}",
           # Order matters: the first matching rule wins. The page's own host is pinned to the validated IP; every other name does not resolve.
           f"--host-resolver-rules=MAP {host} {ip} , MAP * ~NOTFOUND",
           f"--virtual-time-budget={VIRTUAL_TIME_MS}", "--dump-dom"]
    if not sandbox:  # needed inside some containers; keep the sandbox on everywhere else
        cmd.insert(2, "--no-sandbox")
    cmd.append(url)
    return cmd


def _run_chrome(cmd: list[str], timeout: float) -> bytes:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise RenderError(f"Rendering took longer than {timeout:g}s") from None
    if proc.returncode not in (0, None):
        raise RenderError(f"Chrome exited with code {proc.returncode}")
    return out[:MAX_DOM_BYTES]


def render(url: str, *, runner=_run_chrome, find=find_chrome, resolve=resolve_and_validate, timeout: float = TIMEOUT_SECONDS) -> str:
    """The page's HTML after JavaScript ran. Raises RenderError when it cannot be done safely or at all."""
    chrome = find()
    if not chrome:
        raise RenderError("Chrome is not installed (set CHROME_PATH to enable JavaScript pages)")
    try:
        v = resolve(url)
    except SSRFValidationError as exc:
        raise RenderError(f"Refused: {exc}") from exc
    profile = tempfile.mkdtemp(prefix="bl-render-")
    try:
        with _slots:
            raw = runner(build_command(chrome, url, v.hostname, v.resolved_ips[0], profile, sandbox=os.environ.get("CHROME_NO_SANDBOX") != "1"), timeout)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    html = raw.decode("utf-8", errors="replace")
    if "<html" not in html.lower():
        raise RenderError("Chrome returned no page")
    return html


class RenderBudget:
    """How many pages one bot run may render, shared across the run (rendering is slow and uses a whole browser)."""

    def __init__(self, n: int):
        self.left = max(0, n)
        self.used = 0

    def take(self) -> bool:
        if self.left <= 0:
            return False
        self.left -= 1
        self.used += 1
        return True
