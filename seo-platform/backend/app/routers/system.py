from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..config import get_settings
from ..services import ai

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user.__dict__ | {"is_admin": user.is_admin}


@router.get("/status")
def status(_: User = Depends(current_user)):
    """What is connected, so the UI can say which data is live and which is sample."""
    s = get_settings()
    return {
        "ai": {"configured": ai.is_configured(), "provider": s.ai_provider},
        "google_oauth": s.google_oauth_enabled,
        "pagespeed_key": bool(s.pagespeed_api_key),
        "places_key": bool(s.google_places_api_key),
        "dataforseo": s.dataforseo_enabled,
        "intake_imap": s.imap_enabled,
        "intake_webhook": bool(s.intake_webhook_token),
        "smtp": bool(s.smtp_host and s.smtp_from),
        "geo_engines": [n for n, k in [("ChatGPT", s.openai_api_key), ("Gemini", s.gemini_api_key), ("Perplexity", s.perplexity_api_key), ("Claude", s.anthropic_api_key), ("DeepSeek", s.deepseek_api_key)] if k],
        "scheduler": s.scheduler_enabled,
    }
