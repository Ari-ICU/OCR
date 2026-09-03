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
    """Tests an API key live against Google's Generative Language API endpoint and checks real-time quota."""
    suffix = api_key[-4:] if len(api_key) >= 4 else "key"
    
    # 1. Quick test against models endpoint to verify key authentication
    url_models = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        req = urllib.request.Request(url_models, headers={"User-Agent": "Gemini-Verifier"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            pass
    except urllib.error.HTTPError as e:
        if e.code in (400, 401):
            key_pool.mark_invalid(api_key)
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": False,
                "status": "invalid",
                "message": "Invalid API Key (Not found on Google servers)"
            }
        elif e.code == 403:
            key_pool.mark_invalid(api_key)
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": False,
                "status": "forbidden",
                "message": "Key Suspended or Access Denied by Google (403)"
            }
        elif e.code != 429:
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

    # 2. Live Generation Quota Probe on gemini-3.6-flash (Checks if 20/day limit was reached on Google)
    url_generate = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key={api_key}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": "ping"}]}],
        "generationConfig": {"maxOutputTokens": 1}
    }).encode("utf-8")
    
    try:
        req = urllib.request.Request(
            url_generate,
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "QuotaChecker"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                key_pool.mark_success(api_key)
                return {
                    "key": api_key,
                    "suffix": suffix,
                    "valid": True if resp.status == 200 else False,
                    "status": "ready",
                    "message": "✅ Active & Has Free Quota Available"
                }
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            pass

        if e.code == 429 or "RESOURCE_EXHAUSTED" in body:
            is_daily = "generaterequestsperday" in body.lower() or "limit: 20" in body.lower() or "limit: 1500" in body.lower()
            key_pool.mark_rate_limited(api_key, cooldown_seconds=60.0, is_daily=is_daily)
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": True,
                "status": "daily_exhausted" if is_daily else "cooldown",
                "message": "⚡ Daily Limit (20/20) Reached on Google" if is_daily else "🔄 Temporary Rate Limit Cooldown"
            }
        elif e.code in (400, 401, 403):
            key_pool.mark_invalid(api_key)
            return {
                "key": api_key,
                "suffix": suffix,
                "valid": False,
                "status": "invalid" if e.code != 403 else "forbidden",
                "message": "Key Rejected by Google (Unauthenticated / Suspended)"
            }
        return {
            "key": api_key,
            "suffix": suffix,
            "valid": True,
            "status": "active",
            "message": f"Valid Key (HTTP {e.code})"
        }
    except Exception as e:
        return {
            "key": api_key,
            "suffix": suffix,
            "valid": True,
            "status": "active",
            "message": f"Valid Key ({str(e)[:40]})"
        }

    return {
        "key": api_key,
        "suffix": suffix,
        "valid": True,
        "status": "ready",
        "message": "✅ Active & Ready"
    }


@router.post("/verify")
def verify_keys_endpoint(req: VerifyKeysRequest):
    """Verifies a list of Gemini API keys live against Google API and detects real daily quota status."""
    import time
    results = []
    for i, k in enumerate(req.keys):
        k_clean = k.strip()
        if k_clean and len(k_clean) > 5:
            if i > 0:
                time.sleep(0.25)  # Gentle pacing to avoid burst 429s during verification
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

