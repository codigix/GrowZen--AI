"""Engine B: local Lighthouse CLI (Node.js + Chrome/Chromium).

Invocation is done via ``subprocess.Popen`` with an explicit argument list
-- never through a shell -- so a malicious URL cannot break out into shell
metacharacters. On Windows the Lighthouse CLI ships as a ``.cmd`` wrapper
which itself must be parsed by ``cmd.exe``; to avoid that parsing layer
entirely (and the metacharacter-injection risk that comes with it) we invoke
Node directly against the Lighthouse package's ``cli/index.js`` entry point,
which is a plain argv-based Node script.

The blocking ``subprocess`` module is used (via ``asyncio.to_thread``)
rather than ``asyncio.create_subprocess_exec``: the latter requires a
``ProactorEventLoop`` on Windows, but uvicorn switches to
``WindowsSelectorEventLoopPolicy`` whenever it's run with ``--reload`` or
multiple workers (e.g. ``fastapi dev``), and ``SelectorEventLoop`` has no
subprocess support on Windows at all, raising ``NotImplementedError`` on
every audit. Running the blocking call in a thread avoids depending on the
event loop's subprocess machinery entirely, so it works the same way
regardless of loop policy or how the server was launched.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.audit_engines.errors import (
    EngineExecutionError,
    EngineNotConfiguredError,
    EngineTimeoutError,
)
from app.security.url_validation import ValidatedURL

_STDERR_TAIL_CHARS = 4000

# Lighthouse's default user agent advertises itself as "...Chrome-Lighthouse",
# which some sites' bot/WAF protection (Cloudflare, Akamai, etc.) blocks
# outright, turning an otherwise-healthy page into an ERRORED_DOCUMENT_REQUEST
# runtime error. Auditing is only meaningful if the page actually loads, so we
# emulate a normal desktop/mobile Chrome user agent instead, the same way
# Google's own PageSpeed Insights service does.
_DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)
_MOBILE_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
)


@dataclass(frozen=True)
class LighthouseCliLocation:
    node_path: str
    cli_js_path: str


def resolve_lighthouse_cli() -> LighthouseCliLocation | None:
    """Best-effort discovery of a local Node + Lighthouse CLI install.

    Returns ``None`` if either dependency is missing so callers can produce
    an informative "not configured" error instead of a crash.
    """
    node_path = shutil.which("node")
    if not node_path:
        return None

    lighthouse_shim = shutil.which("lighthouse")
    candidates: list[Path] = []
    if lighthouse_shim:
        shim_dir = Path(lighthouse_shim).resolve().parent
        candidates.append(shim_dir / "node_modules" / "lighthouse" / "cli" / "index.js")

    # Fall back to a lighthouse package installed alongside this project.
    candidates.append(Path(__file__).resolve().parents[2] / "node_modules" / "lighthouse" / "cli" / "index.js")

    for candidate in candidates:
        if candidate.is_file():
            return LighthouseCliLocation(node_path=node_path, cli_js_path=str(candidate))
    return None


def is_lighthouse_available() -> bool:
    return resolve_lighthouse_cli() is not None


def _run_subprocess(node_path: str, args: list[str], timeout_seconds: int) -> tuple[int, bytes]:
    """Run Node + the Lighthouse CLI to completion (blocking). Intended to be
    called via ``asyncio.to_thread`` -- see module docstring for why this is
    used instead of ``asyncio.create_subprocess_exec``."""
    process = subprocess.Popen(
        [node_path, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        _, stderr_bytes = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise
    return process.returncode, stderr_bytes


async def run_lighthouse_audit(
    *,
    url: str,
    strategy: str,
    timeout_seconds: int,
    reports_dir: Path,
    audit_id: str,
    validated: ValidatedURL | None = None,
) -> dict:
    """Run a real Lighthouse audit via the local CLI.

    Returns a dict with ``raw_json`` (parsed Lighthouse report), and the
    on-disk ``json_path`` / ``html_path`` of the generated reports.
    """
    cli = resolve_lighthouse_cli()
    if cli is None:
        raise EngineNotConfiguredError(
            "Local Lighthouse engine is not available: Node.js and/or the "
            "'lighthouse' npm package could not be found. Install Node.js "
            "and run 'npm install -g lighthouse', or select the PageSpeed "
            "Insights engine instead."
        )

    reports_dir.mkdir(parents=True, exist_ok=True)
    output_base = reports_dir / f"{audit_id}-{uuid.uuid4().hex[:8]}"

    chrome_flags = ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    if validated is not None and validated.resolved_ips:
        # Pin DNS resolution to the IP we already validated as safe, so a
        # rebind between validation and fetch cannot redirect Chrome to an
        # internal address.
        chrome_flags.append(
            f"--host-resolver-rules=MAP {validated.hostname} {validated.resolved_ips[0]}"
        )

    user_agent = _DESKTOP_USER_AGENT if strategy == "desktop" else _MOBILE_USER_AGENT

    args = [
        cli.cli_js_path,
        url,
        "--output=json",
        "--output=html",
        f"--output-path={output_base}",
        "--only-categories=performance,accessibility,best-practices,seo",
        f"--chrome-flags={' '.join(chrome_flags)}",
        f"--emulated-user-agent={user_agent}",
        "--max-wait-for-load=45000",
        "--quiet",
    ]
    if strategy == "desktop":
        args.append("--preset=desktop")
    else:
        args.append("--form-factor=mobile")
        args.append("--screenEmulation.mobile")

    try:
        returncode, stderr_bytes = await asyncio.to_thread(
            _run_subprocess, cli.node_path, args, timeout_seconds
        )
    except subprocess.TimeoutExpired as exc:
        raise EngineTimeoutError(
            f"Local Lighthouse audit timed out after {timeout_seconds}s"
        ) from exc

    json_path = output_base.with_name(output_base.name + ".report.json")
    html_path = output_base.with_name(output_base.name + ".report.html")

    if returncode != 0 or not json_path.is_file():
        stderr_text = stderr_bytes.decode("utf-8", errors="replace")[-_STDERR_TAIL_CHARS:]
        raise EngineExecutionError(
            "Local Lighthouse audit failed to produce a report "
            f"(exit code {returncode}). Chrome/Chromium may be "
            f"missing or the page may be unreachable. Details: {stderr_text.strip()}"
        )

    try:
        raw_json = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EngineExecutionError(f"Could not read Lighthouse JSON report: {exc}") from exc

    runtime_error = raw_json.get("runtimeError")
    if runtime_error:
        code = runtime_error.get("code", "UNKNOWN_ERROR")
        message = runtime_error.get("message", "Lighthouse could not audit the page.")
        hint = ""
        if code == "ERRORED_DOCUMENT_REQUEST" or "403" in message:
            hint = (
                " The target site likely has bot/WAF protection (e.g. Cloudflare "
                "or Akamai) blocking the audit request, rather than a problem "
                "with this tool. If you control the site, allowlist this "
                "server's IP or exempt the Lighthouse user agent."
            )
        raise EngineExecutionError(f"Lighthouse could not audit the page ({code}): {message}.{hint}")

    return {
        "raw_json": raw_json,
        "json_path": str(json_path),
        "html_path": str(html_path) if html_path.is_file() else None,
    }
