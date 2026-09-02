import base64
from fastapi import APIRouter
from app.models.schemas import (
    TextCorrectionRequest,
    TextCorrectionResponse,
    ReprocessPageRequest
)
from app.services.ai_service import AIService

router = APIRouter(tags=["Text Correction & Playground"])

@router.post("/correct-text", response_model=TextCorrectionResponse)
async def correct_text_endpoint(req: TextCorrectionRequest):
    """Directly corrects raw Khmer text using STEM proofreading prompt."""
    res = await AIService.process_page_text_async(
        raw_text=req.text,
        page_number=req.page_number or 1,
        provider=req.provider or "gemini",
        api_key=req.api_key,
        preferred_model=req.model
    )
    return res

@router.post("/reprocess-page", response_model=TextCorrectionResponse)
async def reprocess_page_endpoint(req: ReprocessPageRequest):
    """Re-runs AI correction / Vision OCR on a single page with specified parameters."""
    is_vision = req.mode == "vision" or (req.model and any(v in req.model.lower() for v in ["vl", "vision", "flash"]))
    
    if is_vision and req.image_base64:
        try:
            b64_str = req.image_base64
            if "," in b64_str:
                b64_str = b64_str.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_str)
            if len(img_bytes) > 0:
                res = await AIService.process_page_vision_async(
                    image_bytes=img_bytes,
                    page_number=req.page_number,
                    provider=req.provider or "gemini",
                    api_key=req.api_key,
                    preferred_model=req.model
                )
                if res.get("success") or res.get("corrected_text"):
                    return res
        except Exception:
            pass

    # Digital text correction fallback
    res = await AIService.process_page_text_async(
        raw_text=req.raw_text or "",
        page_number=req.page_number,
        provider=req.provider or "gemini",
        api_key=req.api_key,
        preferred_model=req.model
    )
    return res
