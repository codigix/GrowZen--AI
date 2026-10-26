"""Shared exception types raised by audit engines."""
from __future__ import annotations


class AuditEngineError(Exception):
    """Base class for engine-level failures surfaced to the audit service."""


class EngineNotConfiguredError(AuditEngineError):
    """Raised when an engine is selected but not configured/available."""


class EngineTimeoutError(AuditEngineError):
    """Raised when an engine invocation exceeds the configured timeout."""


class EngineQuotaError(AuditEngineError):
    """Raised when an external API reports a quota/rate-limit failure."""


class EngineExecutionError(AuditEngineError):
    """Raised when an engine fails to produce a usable report."""
