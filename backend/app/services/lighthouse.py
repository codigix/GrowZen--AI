"""Local Lighthouse CLI (Node.js + Chrome/Chromium): full Lighthouse reports, JSON and the original HTML.

Lighthouse is started with `subprocess.Popen` and an explicit argument list, never a shell, so a
URL can't inject shell metacharacters. On Windows the `lighthouse` command is a `.cmd` wrapper
that cmd.exe would have to parse; Node is run directly against the package's `cli/index.js`
instead, which skips that layer. The call blocks, so it runs in a worker thread
(see lighthouse_runner); that also works under any asyncio loop policy, unlike
`asyncio.create_subprocess_exec`, which has no subprocess support on Windows' SelectorEventLoop
(used by uvicorn with --reload or several workers).

Install: Node.js LTS, then `npm install -g lighthouse`, plus Chrome or Edge. Or install the
`lighthouse` npm package in the backend folder.
"""
import json
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .url_safety import ValidatedURL

_STDERR_TAIL_CHARS = 4000

# Lighthouse's default user agent says "Chrome-Lighthouse", which bot/WAF protection (Cloudflare,
# Akamai, ...) often blocks, turning a healthy page into ERRORED_DOCUMENT_REQUEST. A normal Chrome
# user agent is sent instead, as PageSpeed Insights does.
_DESKTOP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
_MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"


class LighthouseError(RuntimeError):
    """The local Lighthouse run produced no usable report."""


class LighthouseNotConfiguredError(LighthouseError):
    pass


class LighthouseTimeoutError(LighthouseError):
    pass


@dataclass(frozen=True)
class LighthouseCli:
    node_path: str
    cli_js_path: str


def resolve_cli() -> LighthouseCli | None:
    """Node + the Lighthouse CLI, or None if either is missing."""
    node_path = shutil.which("node")
    if not node_path:
        return None
    candidates: list[Path] = []
    shim = shutil.which("lighthouse")
    if shim:
        candidates.append(Path(shim).resolve().parent / "node_modules" / "lighthouse" / "cli" / "index.js")
    # A lighthouse package installed in the backend folder.
    candidates.append(Path(__file__).resolve().parents[2] / "node_modules" / "lighthouse" / "cli" / "index.js")
    for c in candidates:
        if c.is_file():
            return LighthouseCli(node_path=node_path, cli_js_path=str(c))
    return None


def is_available() -> bool:
    return resolve_cli() is not None


def _run_subprocess(node_path: str, args: list[str], timeout_seconds: float) -> tuple[int, bytes]:
    process = subprocess.Popen([node_path, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        _, stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise
    return process.returncode, stderr


def run_audit(*, url: str, strategy: str, timeout_seconds: float, reports_dir: Path, audit_id: Any,
              validated: ValidatedURL | None = None) -> dict[str, Any]:
    """Run Lighthouse. Returns {raw_json, json_path, html_path} (html_path None if not written)."""
    cli = resolve_cli()
    if cli is None:
        raise LighthouseNotConfiguredError(
            "Local Lighthouse engine is not available: Node.js and/or the 'lighthouse' npm package could not be "
            "found. Install Node.js and run 'npm install -g lighthouse', or select the PageSpeed Insights engine instead.")

    reports_dir.mkdir(parents=True, exist_ok=True)
    output_base = reports_dir / f"{audit_id}-{uuid.uuid4().hex[:8]}"

    chrome_flags = [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        "--allow-running-insecure-content",
        "--disable-features=SafeBrowsing,OptimizationHints"
    ]
    if validated is not None and validated.resolved_ips:
        # Pin DNS to the IP already validated, so a rebind before the fetch can't reach an internal address.
        chrome_flags.append(f"--host-resolver-rules=MAP {validated.hostname} {validated.resolved_ips[0]}")

    args = [
        cli.cli_js_path, url,
        "--output=json", "--output=html", f"--output-path={output_base}",
        "--only-categories=performance,accessibility,best-practices,seo",
        f"--chrome-flags={' '.join(chrome_flags)}",
        f"--emulated-user-agent={_DESKTOP_USER_AGENT if strategy == 'desktop' else _MOBILE_USER_AGENT}",
        "--max-wait-for-load=45000", "--quiet",
    ]
    args += ["--preset=desktop"] if strategy == "desktop" else ["--form-factor=mobile", "--screenEmulation.mobile"]

    try:
        returncode, stderr = _run_subprocess(cli.node_path, args, timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        raise LighthouseTimeoutError(f"Local Lighthouse audit timed out after {timeout_seconds:g}s") from exc

    json_path = output_base.with_name(output_base.name + ".report.json")
    html_path = output_base.with_name(output_base.name + ".report.html")
    if returncode != 0 or not json_path.is_file():
        tail = stderr.decode("utf-8", errors="replace")[-_STDERR_TAIL_CHARS:].strip()
        if "interstitial" in tail.lower():
            hint = " (Chrome halted because the target URL either timed out, refused connections, or returned an unreachable interstitial. Verify the URL is online and responding)."
        elif "timeout" in tail.lower():
            hint = " (The target server took too long to respond)."
        else:
            hint = ""
        raise LighthouseError(f"Local Lighthouse audit failed to produce a report (exit code {returncode}).{hint} Details: {tail}")
    try:
        raw_json = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LighthouseError(f"Could not read Lighthouse JSON report: {exc}") from exc

    runtime_error = raw_json.get("runtimeError")
    if runtime_error:
        code = runtime_error.get("code", "UNKNOWN_ERROR")
        message = runtime_error.get("message", "Lighthouse could not audit the page.")
        hint = ""
        if code == "ERRORED_DOCUMENT_REQUEST" or "403" in message:
            hint = (" The target site likely has bot/WAF protection (e.g. Cloudflare or Akamai) blocking the audit "
                    "request, rather than a problem with this tool. If you control the site, allowlist this "
                    "server's IP or exempt the Lighthouse user agent.")
        raise LighthouseError(f"Lighthouse could not audit the page ({code}): {message}.{hint}")

    return {"raw_json": raw_json, "json_path": str(json_path), "html_path": str(html_path) if html_path.is_file() else None}
