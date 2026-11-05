"""Set up Fortress for the Ahrefs backlink lookup on this machine.

The browser (about 250 MB download) and the Python environment are not in git, so every machine makes its own:
  1. .venv/       a Python environment with Playwright (only the Python package; Playwright's own browsers are not needed)
  2. browsers/    the official Fortress build for this OS, downloaded from GitHub and checked against its SHA-256

Run it once from the repo root (any Python 3.10+):
    python fortress-repo/setup_fortress.py

The backend also runs it on its own before the first Ahrefs lookup if something is missing (AHREFS_AUTO_SETUP=0 turns that off).
Running it again does nothing when everything is already in place. Uses only the standard library.
"""
import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = "153.0.8010.36"
PLAYWRIGHT = "playwright==1.64.1"
BASE_URL = f"https://github.com/tiliondev/fortress/releases/download/v{VERSION}"

# platform -> (release file, its SHA-256 from the release's SHA256SUMS). Pinned here so a changed download is refused.
ASSETS = {
    "win-x64": ("fortress-v153-win-x64.zip", "adcb11912654637c76615c146fa6b65afaa4da72d42459530332a2c05f9e6b82"),
    "linux-x64": ("fortress-v153-linux-x64.tar.gz", "27a2661d531bbbab14875992ba44fda61622d1aaf3ee0ee5fa5d69d0d02863b6"),
    "mac-arm64": ("fortress-v153-mac-arm64.tar.gz", "f9fabcc4971f44110ad9e19b6f9d9ad30823bc8570cbaad58b041d5c086e531a"),
}


def platform_key() -> str:
    system, machine = platform.system(), platform.machine().lower()
    if system == "Windows" and machine in ("amd64", "x86_64"):
        return "win-x64"
    if system == "Linux" and machine in ("x86_64", "amd64"):
        return "linux-x64"
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        return "mac-arm64"
    raise SystemExit(f"Fortress has no build for {system} {machine} (supported: Windows x64, Linux x64, macOS Apple Silicon)")


def browser_root() -> Path:
    return HERE / "browsers" / VERSION / platform_key()


def find_browser(root: Path | None = None) -> Path | None:
    """The browser executable inside the extracted build, or None if it is not there."""
    root = root or browser_root()
    if not root.is_dir():
        return None
    if os.name == "nt":
        found = list(root.rglob("chrome.exe"))
    elif platform.system() == "Darwin":
        found = [p for p in root.glob("**/*.app/Contents/MacOS/*") if p.is_file()]
    else:
        found = [p for p in root.rglob("chrome") if p.is_file()]
    # The main executable is the one nearest the top (a macOS .app also holds helper apps deeper down).
    return min(found, key=lambda p: (len(p.parts), str(p))) if found else None


def venv_python() -> Path:
    return HERE / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def is_ready() -> bool:
    return venv_python().is_file() and find_browser() is not None


def _say(msg: str) -> None:
    print(f"[fortress setup] {msg}", flush=True)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def setup_venv() -> None:
    python = venv_python()
    if python.is_file():
        try:
            if subprocess.run([str(python), "-c", "import playwright"], capture_output=True).returncode == 0:
                _say(".venv is ready")
                return
            works = subprocess.run([str(python), "-c", "pass"], capture_output=True).returncode == 0
        except OSError:
            works = False
    else:
        works = False
    if not works:
        # Missing, or copied from another machine (it points at a Python that is not here): build it again.
        _say("creating .venv")
        subprocess.run([sys.executable, "-m", "venv", "--clear", str(HERE / ".venv")], check=True)
    _say(f"installing {PLAYWRIGHT}")
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-q", PLAYWRIGHT], check=True)


def _is_admin() -> bool:
    if os.name != "nt":
        return True
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def register_firewall_rule(browser: Path) -> None:
    """Windows only: pre-approve this exact binary so it never shows the "allow this app through the firewall" popup. That popup
    needs a human to click it; a headless server (or this running as a service, with no one logged into a desktop) either blocks on
    it forever or has the connection silently dropped. Needs an elevated (Administrator) process; otherwise this is skipped with a
    warning, so a server provisioned without admin rights can have someone run this script once as Administrator to fix it."""
    if os.name != "nt":
        return
    if not _is_admin():
        _say("not running as Administrator: skipping the firewall rule. On a server, run this script once as Administrator so "
             "Fortress is pre-approved and never shows the 'allow this app' popup (nobody is there to click it).")
        return
    name = "Fortress Chromium"
    try:
        subprocess.run(["netsh", "advfirewall", "firewall", "delete", "rule", f"name={name}"], capture_output=True)
        for direction in ("in", "out"):
            subprocess.run(["netsh", "advfirewall", "firewall", "add", "rule", f"name={name}", f"dir={direction}",
                             "action=allow", f"program={browser}", "enable=yes", "profile=any"], check=True, capture_output=True)
        _say(f"firewall rule added for {browser}: it will not prompt for this binary again")
    except (OSError, subprocess.CalledProcessError) as exc:
        _say(f"could not add the firewall rule ({exc}); it may still show the 'allow this app' popup on first launch")


def setup_browser() -> None:
    root = browser_root()
    existing = find_browser(root)
    if existing:
        _say(f"browser is ready: {existing}")
        register_firewall_rule(existing)
        return
    asset, expected = ASSETS[platform_key()]
    url = f"{BASE_URL}/{asset}"
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / asset
        _say(f"downloading {url} (about 250 MB, this takes a few minutes)")
        urllib.request.urlretrieve(url, archive)
        actual = _sha256(archive)
        if actual != expected:
            raise SystemExit(f"SHA-256 of {asset} is {actual}, expected {expected}: the download is refused")
        _say("SHA-256 verified, extracting")
        staging = Path(tmp) / "out"
        if asset.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                z.extractall(staging)
        else:
            with tarfile.open(archive) as t:
                t.extractall(staging, filter="data") if sys.version_info >= (3, 12) else t.extractall(staging)
        if root.exists():
            shutil.rmtree(root)
        root.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging), str(root))
    browser = find_browser(root)
    if browser is None:
        raise SystemExit(f"the build was extracted to {root} but no browser executable was found in it")
    if os.name != "nt":
        browser.chmod(0o755)
    else:
        register_firewall_rule(browser)
    _say(f"browser is ready: {browser}")


def main() -> None:
    if "--check" in sys.argv:  # run with .venv's Python by the backend: exit 0 when Playwright imports and the browser is in place
        try:
            import playwright  # noqa: F401
        except ImportError:
            raise SystemExit(1)
        raise SystemExit(0 if is_ready() else 1)
    setup_venv()
    setup_browser()
    _say("done")


if __name__ == "__main__":
    main()
