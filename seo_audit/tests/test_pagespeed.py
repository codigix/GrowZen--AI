from __future__ import annotations

import httpx
import pytest
import respx

from app.audit_engines.errors import EngineExecutionError, EngineQuotaError, EngineTimeoutError
from app.audit_engines.pagespeed import PSI_ENDPOINT, run_pagespeed_audit


@pytest.mark.asyncio
@respx.mock
async def test_run_pagespeed_audit_success(lighthouse_result):
    respx.get(PSI_ENDPOINT).mock(
        return_value=httpx.Response(200, json={"lighthouseResult": lighthouse_result})
    )
    data = await run_pagespeed_audit(url="https://example.com", strategy="mobile", api_key="k", timeout_seconds=30)
    assert data["lighthouseResult"]["requestedUrl"] == "https://example.com/"


@pytest.mark.asyncio
@respx.mock
async def test_run_pagespeed_audit_quota_429():
    respx.get(PSI_ENDPOINT).mock(return_value=httpx.Response(429, json={"error": {"message": "quota"}}))
    with pytest.raises(EngineQuotaError):
        await run_pagespeed_audit(url="https://example.com", strategy="mobile", api_key="k", timeout_seconds=30)


@pytest.mark.asyncio
@respx.mock
async def test_run_pagespeed_audit_quota_403():
    respx.get(PSI_ENDPOINT).mock(
        return_value=httpx.Response(
            403, json={"error": {"message": "Quota exceeded for quota metric", "status": "RESOURCE_EXHAUSTED"}}
        )
    )
    with pytest.raises(EngineQuotaError):
        await run_pagespeed_audit(url="https://example.com", strategy="mobile", api_key="k", timeout_seconds=30)


@pytest.mark.asyncio
@respx.mock
async def test_run_pagespeed_audit_generic_error():
    respx.get(PSI_ENDPOINT).mock(return_value=httpx.Response(400, json={"error": {"message": "Invalid URL"}}))
    with pytest.raises(EngineExecutionError):
        await run_pagespeed_audit(url="https://example.com", strategy="mobile", api_key="k", timeout_seconds=30)


@pytest.mark.asyncio
@respx.mock
async def test_run_pagespeed_audit_timeout():
    respx.get(PSI_ENDPOINT).mock(side_effect=httpx.TimeoutException("timed out"))
    with pytest.raises(EngineTimeoutError):
        await run_pagespeed_audit(url="https://example.com", strategy="mobile", api_key="k", timeout_seconds=1)


@pytest.mark.asyncio
@respx.mock
async def test_run_pagespeed_audit_missing_lighthouse_result():
    respx.get(PSI_ENDPOINT).mock(return_value=httpx.Response(200, json={"captchaResult": "blocked"}))
    with pytest.raises(EngineExecutionError):
        await run_pagespeed_audit(url="https://example.com", strategy="mobile", api_key="k", timeout_seconds=30)
