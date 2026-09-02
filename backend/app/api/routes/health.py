from typing import Optional
from fastapi import APIRouter, Query
from app.core.config import settings
from app.services.key_manager import key_pool

router = APIRouter(tags=["Health & Models"])

@router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "active_models": settings.MODEL_METADATA,
        "default_model": settings.MODELS_TO_TRY[0]
    }

@router.get("/models")
def get_models():
    """Returns the list of supported active Gemini & Ollama models with metadata."""
    return {
        "models": settings.MODEL_METADATA,
        "default": settings.MODELS_TO_TRY[0]
    }

from pydantic import BaseModel

class KeyPoolStatusRequest(BaseModel):
    api_key: Optional[str] = None

@router.api_route("/key-pool-status", methods=["GET", "POST"])
def get_key_pool_status_route(api_key: Optional[str] = Query(None), req: Optional[KeyPoolStatusRequest] = None):
    """Returns real-time status and cooldown countdowns for all keys in the pool."""
    effective_key = (req.api_key if req and req.api_key else api_key)
    keys = key_pool.get_candidate_keys(effective_key)
    statuses = key_pool.get_status_detailed(effective_key)
    total_used = sum(s.get("usage_count", 0) for s in statuses)
    total_tokens = sum(s.get("tokens_used", 0) for s in statuses)
    total_quota = len(keys) * 20 if keys else 20
    return {
        "pool": statuses,
        "summary": {
            "total_keys": len(keys),
            "total_speed_rpm": len(keys) * 15 if keys else 15,
            "total_tpm": f"{max(1, len(keys))}M",
            "total_daily_quota": total_quota,
            "total_used": total_used,
            "total_tokens_used": total_tokens,
            "daily_remaining": max(0, total_quota - total_used)
        }
    }

