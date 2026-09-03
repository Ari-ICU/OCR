import json
import urllib.error
import urllib.request
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.services.key_manager import key_pool

router = APIRouter(prefix="/keys", tags=["API Keys"])


class VerifyKeysRequest(BaseModel):
    keys: List[str]


def verify_single_key(api_key: str) -> Dict[str, Any]:
    """Tests an API key live against Google's Generative Language API endpoint."""
    suffix = api_key[-4:] if len(api_key) >= 4 else "key"
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Gemini-Verifier"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                return {
                    "key": api_key,
                    "suffix": suffix,
                    "valid": True,
                    "status": "active",
                    "message": "Valid & Active Google Gemini Key"
                }
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        
        if e.code == 400:
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": False,
                "status": "invalid",
                "message": "API key not valid / not found on Google servers"
            }
        elif e.code == 403:
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": False,
                "status": "forbidden",
                "message": "Permission denied / Key access denied or suspended by Google"
            }
        elif e.code == 429:
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": True,
                "status": "rate_limited",
                "message": "Valid Google Key (Rate limit / Quota currently active)"
            }
        return {
            "key": api_key,
            "suffix": suffix,
            "valid": False,
            "status": "error",
            "message": f"HTTP {e.code}: {e.reason}"
        }
    except Exception as e:
        return {
            "key": api_key,
            "suffix": suffix,
            "valid": False,
            "status": "network_error",
            "message": str(e)
        }
    return {
        "key": api_key,
        "suffix": suffix,
        "valid": False,
        "status": "unknown",
        "message": "Unknown verification failure"
    }


@router.post("/verify")
def verify_keys_endpoint(req: VerifyKeysRequest):
    """Verifies a list of Gemini API keys live and returns their health and validity status."""
    results = []
    for k in req.keys:
        k_clean = k.strip()
        if k_clean and len(k_clean) > 5:
            results.append(verify_single_key(k_clean))
    return {"results": results}


@router.get("/status")
def get_key_pool_status(api_key: Optional[str] = None):
    """Returns real-time health, in-flight leases, cooldowns, and token counts for all active keys."""
    raw_keys = key_pool.parse_keys(api_key)
    candidate_keys = key_pool.get_candidate_keys(api_key)
    detailed = key_pool.get_status_detailed(api_key)
    
    total_tokens = sum(k.get("tokens_used", 0) for k in detailed)
    total_used_reqs = sum(k.get("usage_count", 0) for k in detailed)
    
    # 20 requests/day per free tier project for gemini-3.6-flash
    total_daily_quota = len(candidate_keys) * 20 if candidate_keys else 20
    daily_remaining = max(0, total_daily_quota - total_used_reqs)

    return {
        "total_keys": len(candidate_keys),
        "pool": detailed,
        "summary": {
            "total_used": total_used_reqs,
            "daily_remaining": daily_remaining,
            "total_tokens_used": total_tokens,
            "total_daily_quota": total_daily_quota
        }
    }


@router.post("/reset-invalid")
def reset_invalid_keys():
    """Resets invalid keys memory in the key pool to allow re-evaluation."""
    key_pool.reset_invalid()
    return {"success": True, "message": "Key pool invalid cache reset successfully"}


@router.post("/reset-cooldowns")
def reset_key_cooldowns():
    """Clears all cooldowns and daily exhausted states across all keys immediately."""
    key_pool.reset_cooldowns()
    return {"success": True, "message": "All key cooldowns and daily caps reset successfully"}

