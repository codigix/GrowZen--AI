from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from app.audit_engines import lighthouse as lighthouse_engine
from app.audit_engines.errors import EngineExecutionError, EngineNotConfiguredError, EngineTimeoutError


def test_resolve_lighthouse_cli_returns_none_without_node(monkeypatch):
    monkeypatch.setattr(lighthouse_engine.shutil, "which", lambda name: None)
    assert lighthouse_engine.resolve_lighthouse_cli() is None


def test_resolve_lighthouse_cli_detects_real_install():
    # This asserts against whatever is actually installed in this dev
    # environment; if Node/Lighthouse are not installed the local engine is
    # correctly reported as unavailable rather than raising.
    location = lighthouse_engine.resolve_lighthouse_cli()
    if location is not None:
        assert Path(location.cli_js_path).is_file()
        assert Path(location.node_path).exists()


@pytest.mark.asyncio
async def test_run_lighthouse_audit_raises_when_not_configured(monkeypatch, tmp_path):
    monkeypatch.setattr(lighthouse_engine, "resolve_lighthouse_cli", lambda: None)
    with pytest.raises(EngineNotConfiguredError):
        await lighthouse_engine.run_lighthouse_audit(
            url="https://example.com",
            strategy="mobile",
            timeout_seconds=5,
            reports_dir=tmp_path,
            audit_id="abc123",
        )


@pytest.mark.asyncio
async def test_run_lighthouse_audit_handles_process_failure(monkeypatch, tmp_path):
    cli = lighthouse_engine.LighthouseCliLocation(node_path="node", cli_js_path="cli.js")
    monkeypatch.setattr(lighthouse_engine, "resolve_lighthouse_cli", lambda: cli)

    class FakeProcess:
        returncode = 1

        def communicate(self, timeout=None):
            return b"", b"Chrome could not be found"

        def kill(self):
            pass

    def fake_popen(*args, **kwargs):
        return FakeProcess()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    with pytest.raises(EngineExecutionError):
        await lighthouse_engine.run_lighthouse_audit(
            url="https://example.com",
            strategy="mobile",
            timeout_seconds=5,
            reports_dir=tmp_path,
            audit_id="abc123",
        )


@pytest.mark.asyncio
async def test_run_lighthouse_audit_handles_timeout(monkeypatch, tmp_path):
    cli = lighthouse_engine.LighthouseCliLocation(node_path="node", cli_js_path="cli.js")
    monkeypatch.setattr(lighthouse_engine, "resolve_lighthouse_cli", lambda: cli)

    class FakeProcess:
        killed = False

        def communicate(self, timeout=None):
            if not FakeProcess.killed:
                raise subprocess.TimeoutExpired(cmd="lighthouse", timeout=timeout)
            return b"", b""

        def kill(self):
            FakeProcess.killed = True

    def fake_popen(*args, **kwargs):
        return FakeProcess()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    with pytest.raises(EngineTimeoutError):
        await lighthouse_engine.run_lighthouse_audit(
            url="https://example.com",
            strategy="mobile",
            timeout_seconds=0.05,
            reports_dir=tmp_path,
            audit_id="abc123",
        )
    assert FakeProcess.killed is True


@pytest.mark.asyncio
async def test_run_lighthouse_audit_surfaces_runtime_error(monkeypatch, tmp_path):
    cli = lighthouse_engine.LighthouseCliLocation(node_path="node", cli_js_path="cli.js")
    monkeypatch.setattr(lighthouse_engine, "resolve_lighthouse_cli", lambda: cli)

    captured_output_base = {}

    class FakeProcess:
        returncode = 0

        def communicate(self, timeout=None):
            return b"", b""

        def kill(self):
            pass

    def fake_popen(args, *rest, **kwargs):
        # args[0] is node_path, the rest is the CLI arg list built above;
        # "--output-path=<base>" is one of them.
        for arg in args:
            if isinstance(arg, str) and arg.startswith("--output-path="):
                base = Path(arg.split("=", 1)[1])
                json_path = base.with_name(base.name + ".report.json")
                json_path.write_text(
                    '{"runtimeError": {"code": "ERRORED_DOCUMENT_REQUEST", "message": "Request to the root page failed (403)"}}',
                    encoding="utf-8",
                )
        return FakeProcess()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    with pytest.raises(EngineExecutionError, match="bot/WAF protection"):
        await lighthouse_engine.run_lighthouse_audit(
            url="https://example.com",
            strategy="mobile",
            timeout_seconds=5,
            reports_dir=tmp_path,
            audit_id="abc123",
        )


@pytest.mark.live
@pytest.mark.asyncio
async def test_live_lighthouse_audit_against_public_site(tmp_path):
    """Optional live integration test: actually launches Lighthouse + Chrome
    against a real public site. Requires Node.js, the 'lighthouse' npm
    package, and Chrome/Chromium to be installed. Skipped unless the
    RUN_LIVE_TESTS=1 environment variable is set, so a normal test run
    never silently claims to have exercised a real network/browser audit.
    """
    if os.environ.get("RUN_LIVE_TESTS") != "1":
        pytest.skip("Set RUN_LIVE_TESTS=1 to run the live Lighthouse integration test")
    if lighthouse_engine.resolve_lighthouse_cli() is None:
        pytest.skip("Local Lighthouse CLI is not available in this environment")

    result = await lighthouse_engine.run_lighthouse_audit(
        url="https://example.com",
        strategy="mobile",
        timeout_seconds=120,
        reports_dir=tmp_path,
        audit_id="live-test",
    )
    assert "categories" in result["raw_json"]
