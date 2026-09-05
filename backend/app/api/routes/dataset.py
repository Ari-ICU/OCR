import re
import json
import time
import uuid
import urllib.parse
import httpx
from pathlib import Path
from typing import Optional, Tuple
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, Field

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from app.core.config import settings
from app.core.security import sanitize_filename, is_safe_url
from app.api.routes.pdf import transform_cloud_url
from app.services.pdf_service import PDFService
from app.services.ai_service import AIService
from app.services.log_service import log_manager

router = APIRouter(prefix="/dataset", tags=["Server Store PDF-to-TXT"])


class UrlConvertToTxtRequest(BaseModel):
    url: str = Field(..., description="PDF URL from server store, cloud link, or web")
    start_page: int = Field(1, ge=1, description="Start page (1-indexed)")
    end_page: Optional[int] = Field(None, description="End page (inclusive)")
    mode: str = Field("vision", description="Conversion mode: 'vision' or 'text'")
    provider: str = Field("gemini", description="AI provider: 'gemini' or 'ollama'")
    model: Optional[str] = Field(None, description="Model override (e.g. gemini-3.7-flash)")
    dpi: int = Field(200, ge=72, le=300, description="DPI for vision OCR")
    use_ai: bool = Field(True, description="Whether to apply AI correction (if False, fast text extraction)")
    save_to_txt: bool = Field(True, description="Automatically save .txt to ./txt/ on server disk")
    save_to_jsonl: bool = Field(True, description="Automatically save clean .jsonl to ./jsonl/ on server disk")
    save_to_pdf_dataset: bool = Field(True, description="Save downloaded PDF to ./pdf/ dataset on server")
    api_key: Optional[str] = Field(None, description="Optional user API key override")


@router.get("/file/{filename:path}")
def get_server_store_test_file(filename: str):
    """
    Lightweight endpoint to serve a sample PDF from server store (./pdf) for testing purposes.
    """
    safe_name = sanitize_filename(filename)
    target_path = settings.DATASET_DIR / safe_name
    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail=f"File '{safe_name}' not found.")

    ascii_name = urllib.parse.quote(safe_name)
    headers = {
        "Content-Disposition": f"inline; filename*=UTF-8''{ascii_name}"
    }
    return FileResponse(path=str(target_path), media_type="application/pdf", headers=headers)


async def fetch_pdf_bytes_from_url(url_str: str) -> Tuple[str, bytes]:
    """
    Downloads a PDF from a remote server store, cloud link, or web URL into server memory
    with SSRF protection, size validation, and filename detection.
    """
    clean_url = transform_cloud_url(url_str.strip())
    
    # SSRF Protection
    is_safe, reason = is_safe_url(clean_url)
    if not is_safe:
        raise HTTPException(status_code=403, detail=f"Security rejection: {reason}")
        
    # Special resolver for interior.gov.kh library detail link
    interior_match = re.search(r'interior\.gov\.kh/(?:(?:kh|en)/)?library/detail/([a-zA-Z0-9_-]+)', clean_url)
    if interior_match:
        doc_hash = interior_match.group(1)
        try:
            with httpx.Client(verify=True, timeout=10.0) as temp_client:
                api_res = temp_client.get(f"https://web-api.interior.gov.kh/api/v1/public/document/{doc_hash}")
                if api_res.status_code == 200:
                    api_json = api_res.json()
                    direct_file = api_json.get("data", {}).get("file_url")
                    if direct_file:
                        safe_df, _ = is_safe_url(direct_file)
                        if safe_df:
                            clean_url = direct_file
        except Exception:
            pass

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=60.0,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0",
                "Accept": "*/*",
                "Accept-Language": "km,en-US;q=0.9,en;q=0.8"
            }
        ) as client:
            resp = await client.get(clean_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to fetch PDF from URL (HTTP {resp.status_code}).")
            
            final_url = str(resp.url)
            final_safe, final_reason = is_safe_url(final_url)
            if not final_safe:
                raise HTTPException(status_code=403, detail=f"Security rejection on redirect: {final_reason}")

            raw_content = resp.content
            if not raw_content or len(raw_content) == 0:
                raise HTTPException(status_code=400, detail="The provided URL returned an empty file.")

            if len(raw_content) > max_bytes:
                raise HTTPException(status_code=413, detail=f"File exceeds maximum permitted size of {settings.MAX_UPLOAD_SIZE_MB}MB.")

            # Determine filename
            cd = resp.headers.get("content-disposition", "")
            filename = None
            if "filename=" in cd:
                match = re.search(r'filename=["\']?([^"\';]+)["\']?', cd)
                if match:
                    filename = match.group(1).strip()

            if not filename:
                parsed_path = urllib.parse.urlparse(clean_url).path
                base = parsed_path.split("/")[-1].strip()
                if base and base.lower().endswith(".pdf"):
                    filename = urllib.parse.unquote(base)

            if not filename:
                filename = f"url_doc_{int(time.time())}.pdf"
            elif not filename.lower().endswith(".pdf"):
                filename += ".pdf"

            filename = sanitize_filename(filename, default="url_document.pdf")
            return filename, raw_content
    except httpx.RequestError as e:
        raise HTTPException(status_code=400, detail=f"Network error when accessing URL: {str(e)}")


@router.post("/url-to-txt")
async def convert_url_pdf_to_txt(req: UrlConvertToTxtRequest):
    """
    Direct Server-Side URL-to-TXT Conversion:
    Fetches the PDF directly on the API server from the provided URL,
    converts it to clean text & LaTeX on the server,
    saves the .txt to ./txt/ and .jsonl to ./jsonl/, and returns the text in the response.
    Zero browser PDF downloads required!
    """
    filename, content = await fetch_pdf_bytes_from_url(req.url)

    if req.save_to_pdf_dataset:
        pdf_path = settings.DATASET_DIR / filename
        try:
            pdf_path.write_bytes(content)
        except Exception:
            pass

    try:
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF document from URL: {str(e)}")

    total_doc_pages = len(doc)
    start_idx = max(0, req.start_page - 1)
    end_idx = min(total_doc_pages, req.end_page) if req.end_page else total_doc_pages

    session_id = f"sess_url_{uuid.uuid4().hex[:8]}"
    AIService.set_active_session(session_id)

    log_manager.emit(
        level="INFO",
        event="SERVER_URL_TO_TXT_START",
        message=f"🌐 Converting PDF from URL '{req.url[:60]}...' (Doc: {filename}, Pages {start_idx + 1}-{end_idx}) directly on server...",
        model=req.model or "gemini-3.7-flash"
    )

    pages_result = []
    txt_blocks = []
    jsonl_records = []

    for page_idx in range(start_idx, end_idx):
        page_num = page_idx + 1
        page = doc[page_idx]

        if AIService.is_cancelled(session_id):
            break

        is_blank = PDFService.is_page_blank(page)
        if is_blank:
            clean_text = "[ទំព័រទទេ / Blank Page]"
            pages_result.append({
                "page_number": page_num,
                "file_name": filename,
                "raw_text": "",
                "corrected_text": clean_text,
                "is_blank": True,
                "model_used": "blank-skipped"
            })
            txt_blocks.append(f"=== Page {page_num} ===\n\n{clean_text}\n\n")
            continue

        raw_text = page.get_text("text").strip()

        if not req.use_ai:
            clean_text = raw_text
            model_used = "pymupdf-direct"
        else:
            if req.mode == "vision":
                img_bytes = PDFService.render_page_image_bytes(page, dpi=req.dpi)
                res = await AIService.process_page_vision_async(
                    image_bytes=img_bytes,
                    page_number=page_num,
                    provider=req.provider,
                    preferred_model=req.model,
                    session_id=session_id,
                    api_key=req.api_key
                )
            else:
                res = await AIService.process_page_text_async(
                    raw_text=raw_text,
                    page_number=page_num,
                    provider=req.provider,
                    preferred_model=req.model,
                    session_id=session_id,
                    api_key=req.api_key
                )
            clean_text = res.get("corrected_text") or raw_text
            model_used = res.get("model_used") or req.model or "gemini"

        pages_result.append({
            "page_number": page_num,
            "file_name": filename,
            "raw_text": raw_text,
            "corrected_text": clean_text,
            "char_count": len(clean_text),
            "word_count": len(clean_text.split()),
            "model_used": model_used
        })

        txt_blocks.append(f"=== Page {page_num} ===\n\n{clean_text}\n\n")

        if not is_blank and clean_text.strip():
            jsonl_records.append(json.dumps({
                "document": filename,
                "page": page_num,
                "doc_page": page_num,
                "text": clean_text.strip(),
                "char_count": len(clean_text.strip()),
                "word_count": len(clean_text.strip().split()),
                "model_used": model_used
            }, ensure_ascii=False))

    doc.close()

    stem = Path(filename).stem
    txt_save_path = None
    jsonl_save_path = None

    if req.save_to_txt and txt_blocks:
        txt_target = settings.TXT_DIR / f"{stem}.txt"
        txt_target.write_text("".join(txt_blocks), encoding="utf-8")
        txt_save_path = str(txt_target.relative_to(settings.BASE_DIR))

    if req.save_to_jsonl and jsonl_records:
        jsonl_target = settings.JSONL_DIR / f"{stem}.jsonl"
        jsonl_target.write_text("\n".join(jsonl_records) + "\n", encoding="utf-8")
        jsonl_save_path = str(jsonl_target.relative_to(settings.BASE_DIR))

    return {
        "success": True,
        "filename": filename,
        "stem": stem,
        "total_pages": total_doc_pages,
        "processed_count": len(pages_result),
        "txt_saved_path": txt_save_path,
        "jsonl_saved_path": jsonl_save_path,
        "pages": pages_result,
        "full_text": "".join(txt_blocks)
    }


@router.post("/url-to-txt-stream")
async def convert_url_pdf_to_txt_stream(req: UrlConvertToTxtRequest):
    """
    Streaming SSE version for URL-to-TXT:
    Downloads the PDF from URL on the server, streams real-time page-by-page progress & LaTeX cards,
    while simultaneously writing .txt and .jsonl directly to the server's disk!
    """
    filename, content = await fetch_pdf_bytes_from_url(req.url)

    if req.save_to_pdf_dataset:
        pdf_path = settings.DATASET_DIR / filename
        try:
            pdf_path.write_bytes(content)
        except Exception:
            pass

    try:
        doc = fitz.open(stream=content, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF document: {str(e)}")

    total_doc_pages = len(doc)
    start_idx = max(0, req.start_page - 1)
    end_idx = min(total_doc_pages, req.end_page) if req.end_page else total_doc_pages
    selected_count = max(0, end_idx - start_idx)

    session_id = f"sess_url_stream_{uuid.uuid4().hex[:8]}"
    AIService.set_active_session(session_id)

    stem = Path(filename).stem
    txt_target = settings.TXT_DIR / f"{stem}.txt" if req.save_to_txt else None
    jsonl_target = settings.JSONL_DIR / f"{stem}.jsonl" if req.save_to_jsonl else None

    if txt_target:
        txt_target.write_text("", encoding="utf-8")
    if jsonl_target:
        jsonl_target.write_text("", encoding="utf-8")

    async def event_generator():
        try:
            yield f"event: init\ndata: {json.dumps({'type': 'init', 'filename': filename, 'total_pages': total_doc_pages, 'selected_count': selected_count, 'start_page': start_idx + 1, 'end_page': end_idx})}\n\n"

            for page_idx in range(start_idx, end_idx):
                page_num = page_idx + 1
                page = doc[page_idx]

                if AIService.is_cancelled(session_id):
                    yield f"event: cancelled\ndata: {json.dumps({'type': 'cancelled', 'message': 'Processing was stopped.'})}\n\n"
                    break

                yield f"event: page_start\ndata: {json.dumps({'type': 'page_start', 'page_number': page_num, 'total_pages': total_doc_pages, 'file_name': filename, 'doc_page_number': page_num})}\n\n"

                is_blank = PDFService.is_page_blank(page)
                thumb = PDFService.render_page_thumbnail_base64(page, dpi=75)

                if is_blank:
                    clean_text = "[ទំព័រទទេ / Blank Page]"
                    page_data = {
                        "type": "page_done",
                        "page_number": page_num,
                        "file_name": filename,
                        "doc_page_number": page_num,
                        "raw_text": "",
                        "corrected_text": clean_text,
                        "is_blank": True,
                        "model_used": "blank-skipped",
                        "thumbnail": thumb,
                        "elapsed_seconds": 0.05,
                        "tokens_used": 0,
                        "char_count": len(clean_text),
                        "word_count": len(clean_text.split()),
                        "success": True
                    }
                    yield f"event: page_done\ndata: {json.dumps(page_data)}\n\n"
                    if txt_target:
                        with open(txt_target, "a", encoding="utf-8") as f:
                            f.write(f"=== Page {page_num} ===\n\n{clean_text}\n\n")
                    continue

                raw_text = page.get_text("text").strip()

                if not req.use_ai:
                    clean_text = raw_text
                    model_used = "pymupdf-direct"
                    elapsed = 0.05
                    tokens = 0
                else:
                    if req.mode == "vision":
                        img_bytes = PDFService.render_page_image_bytes(page, dpi=req.dpi)
                        res = await AIService.process_page_vision_async(
                            image_bytes=img_bytes,
                            page_number=page_num,
                            provider=req.provider,
                            preferred_model=req.model,
                            session_id=session_id,
                            api_key=req.api_key
                        )
                    else:
                        res = await AIService.process_page_text_async(
                            raw_text=raw_text,
                            page_number=page_num,
                            provider=req.provider,
                            preferred_model=req.model,
                            session_id=session_id,
                            api_key=req.api_key
                        )
                    clean_text = res.get("corrected_text") or raw_text
                    model_used = res.get("model_used") or req.model or "gemini"
                    elapsed = res.get("elapsed_seconds", 1.0)
                    tokens = res.get("total_tokens", 0)

                page_data = {
                    "type": "page_done",
                    "page_number": page_num,
                    "file_name": filename,
                    "doc_page_number": page_num,
                    "raw_text": raw_text,
                    "corrected_text": clean_text,
                    "char_count": len(clean_text),
                    "word_count": len(clean_text.split()),
                    "has_formulas": ("=" in clean_text or "+" in clean_text or "\\" in clean_text),
                    "model_used": model_used,
                    "thumbnail": thumb,
                    "elapsed_seconds": elapsed,
                    "tokens_used": tokens,
                    "success": True
                }
                yield f"event: page_done\ndata: {json.dumps(page_data)}\n\n"

                if txt_target:
                    with open(txt_target, "a", encoding="utf-8") as f:
                        f.write(f"=== Page {page_num} ===\n\n{clean_text}\n\n")

                if jsonl_target and clean_text.strip():
                    with open(jsonl_target, "a", encoding="utf-8") as f:
                        record = {
                            "document": filename,
                            "page": page_num,
                            "doc_page": page_num,
                            "text": clean_text.strip(),
                            "char_count": len(clean_text.strip()),
                            "word_count": len(clean_text.strip().split()),
                            "model_used": model_used
                        }
                        f.write(json.dumps(record, ensure_ascii=False) + "\n")

            doc.close()

            txt_rel = str(txt_target.relative_to(settings.BASE_DIR)) if txt_target else None
            jsonl_rel = str(jsonl_target.relative_to(settings.BASE_DIR)) if jsonl_target else None

            yield f"event: done\ndata: {json.dumps({'type': 'done', 'status': 'completed', 'filename': filename, 'txt_saved_path': txt_rel, 'jsonl_saved_path': jsonl_rel})}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
