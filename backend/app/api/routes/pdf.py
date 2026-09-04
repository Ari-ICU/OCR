import json
import asyncio
import re
import urllib.parse
import httpx
import logging
from typing import Optional, Dict, List, Tuple, Any
from fastapi import APIRouter, Request, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse, Response

logger = logging.getLogger(__name__)

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from app.core.config import settings
from app.core.security import (
    is_safe_url,
    sanitize_filename,
    validate_file_signature,
    api_rate_limiter,
    fetch_rate_limiter
)
from app.services.pdf_service import PDFService
from app.services.ai_service import AIService
from app.services.log_service import log_manager

router = APIRouter(tags=["PDF & Image Processing & Streaming"])

SUPPORTED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif")

# Global set of in-flight page processing tasks across all sessions
ACTIVE_PROCESSING_TASKS: set[asyncio.Task] = set()

@router.post("/cancel-all-processing")
async def cancel_all_processing_endpoint():
    """Cancels all currently running background OCR and PDF processing tasks immediately."""
    AIService.cancel_session()
    cancelled_count = 0
    for task in list(ACTIVE_PROCESSING_TASKS):
        if not task.done():
            task.cancel()
            cancelled_count += 1
    ACTIVE_PROCESSING_TASKS.clear()
    log_manager.emit(
        level="WARN",
        event="PROCESSING_CANCELLED",
        message=f"🛑 User changed file or clicked cancel. Stopped {cancelled_count} active page workers.",
        model="system"
    )
    return {"status": "cancelled", "tasks_cancelled": cancelled_count}

async def parse_request_files(request: Request) -> Tuple[List[Tuple[str, bytes]], Dict[str, Any]]:
    """Robustly extracts all uploaded files and form fields with security validations."""
    form = await request.form()
    
    # Collect all file objects submitted under any key in multipart form
    uploads: List[UploadFile] = []
    for key, value in form.multi_items():
        if hasattr(value, "filename") and hasattr(value, "read"):
            if value not in uploads:
                uploads.append(value)
                
    if not uploads:
        for key in ["files", "file"]:
            for item in form.getlist(key):
                if hasattr(item, "filename") and hasattr(item, "read"):
                    if item not in uploads:
                        uploads.append(item)
                
    if not uploads:
        raise HTTPException(status_code=400, detail="No PDF or image files were received. Please select a file.")
    
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    files_data: List[Tuple[str, bytes]] = []
    
    for f in uploads:
        # Sanitize filename against Path Traversal
        fname = sanitize_filename(f.filename or "document.pdf")
        
        # Determine extension if missing
        if "." not in fname:
            ctype = (f.content_type or "").lower()
            if "pdf" in ctype:
                fname += ".pdf"
            elif "jpeg" in ctype or "jpg" in ctype:
                fname += ".jpg"
            elif "webp" in ctype:
                fname += ".webp"
            else:
                fname += ".png"
                
        fname_lower = fname.lower()
        if not any(fname_lower.endswith(ext) for ext in SUPPORTED_EXTENSIONS):
            raise HTTPException(status_code=400, detail=f"File '{fname}' format is unsupported. Only PDF, PNG, JPG, WEBP, and TIFF are supported.")
            
        content = await f.read()
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail=f"File '{fname}' is empty (0 bytes). Please select a valid document.")
            
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File '{fname}' exceeds the maximum allowed size of {settings.MAX_UPLOAD_SIZE_MB}MB."
            )
            
        # Magic bytes signature validation
        is_valid, reason = validate_file_signature(content, fname)
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Security rejection for '{fname}': {reason}")
            
        files_data.append((fname, content))
    
    # Extract form fields
    fields = {}
    for key, value in form.items():
        if isinstance(value, str):
            fields[key] = value

    return files_data, fields

@router.post("/extract-preview")
async def extract_preview_endpoint(
    request: Request,
    start_page: int = Query(1),
    end_page: Optional[int] = Query(None)
):
    """Extracts raw text, metadata, and visual page thumbnails for instant preview from single or multiple PDF/Image files."""
    client_ip = request.client.host if request.client else "unknown"
    if not api_rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment before sending another request.")

    files_data, _ = await parse_request_files(request)
    extracted = PDFService.extract_pages_from_files(
        files_data,
        start_page=start_page,
        end_page=end_page,
        include_thumbnails=True
    )
    return extracted

@router.post("/extract-correct-stream")
async def extract_correct_stream(request: Request):
    """
    Streams page-by-page progress, page thumbnails, and AI corrections via Server-Sent Events (SSE).
    Supports single/multi-page PDFs as well as single or multiple image uploads (PNG, JPG, WEBP, TIFF).
    """
    files_data, fields = await parse_request_files(request)

    mode = fields.get("mode", "vision")
    provider = fields.get("provider", "gemini")
    model = fields.get("model") or None
    api_key = fields.get("api_key") or None
    ollama_url = fields.get("ollama_url") or settings.DEFAULT_OLLAMA_URL
    
    try:
        dpi = int(fields.get("dpi", 200))
    except (ValueError, TypeError):
        dpi = 200

    try:
        start_page = int(fields.get("start_page", 1))
    except (ValueError, TypeError):
        start_page = 1

    end_page = None
    if fields.get("end_page"):
        try:
            end_page = int(fields["end_page"])
        except (ValueError, TypeError):
            end_page = None

    try:
        concurrency = int(fields.get("concurrency", 2))
    except (ValueError, TypeError):
        concurrency = 2

    is_local_ollama = (provider == "ollama" or (model and any(k in model.lower() for k in [":7b", ":14b", ":32b", "qwen2.5vl", "llama3.2-vision"])))
    if is_local_ollama:
        max_concurrency = 1
    else:
        max_concurrency = max(1, min(concurrency, 2))
    render_dpi = max(72, min(dpi, 300))
    doc_title = files_data[0][0] if len(files_data) == 1 else f"{len(files_data)} Merged Images"
    
    skip_pages_raw = fields.get("skip_pages", "")
    skip_pages = set()
    if skip_pages_raw:
        try:
            parsed = json.loads(skip_pages_raw)
            if isinstance(parsed, list):
                skip_pages = set(int(x) for x in parsed)
        except Exception:
            pass
    
    async def event_generator():
        try:
            doc = PDFService.create_document_from_files_data(files_data)
            total_doc_pages = len(doc)
            
            s_idx = max(0, start_page - 1)
            e_idx = min(total_doc_pages, end_page) if end_page else total_doc_pages
            selected_pages_count = max(0, e_idx - s_idx)
            
            # Pre-extract all page images, thumbnails, and raw text safely in memory
            pages_bundle = []
            pages_overview = []
            for i in range(s_idx, e_idx):
                p = doc[i]
                raw_txt = p.get_text("text").strip()
                thumb = PDFService.render_page_thumbnail_base64(p, dpi=75)
                highres_img = PDFService.render_page_image_bytes(p, dpi=render_dpi)
                pages_overview.append({
                    "page_number": i + 1,
                    "raw_text": raw_txt,
                    "char_count": len(raw_txt),
                    "word_count": len(raw_txt.split()),
                    "has_formulas": ("=" in raw_txt or "+" in raw_txt or "\\" in raw_txt),
                    "thumbnail": thumb
                })
                pages_bundle.append({
                    "page_number": i + 1,
                    "raw_text": raw_txt,
                    "image_bytes": highres_img
                })
            
            # Close PyMuPDF document immediately to free memory and avoid thread locks
            doc.close()

            yield f"event: init\ndata: {json.dumps({'filename': doc_title, 'total_pages': selected_pages_count, 'doc_total_pages': total_doc_pages, 'start_page': s_idx + 1, 'end_page': e_idx, 'mode': mode, 'provider': provider, 'model': model or settings.MODELS_TO_TRY[0], 'metadata': {'title': doc_title, 'author': 'Unknown'}, 'pages_overview': pages_overview})}\n\n"
            
            if selected_pages_count == 0:
                yield f"event: done\ndata: {json.dumps({'total_pages': 0, 'full_text': ''})}\n\n"
                return

            semaphore = asyncio.Semaphore(max_concurrency)
            event_queue: asyncio.Queue = asyncio.Queue()
            all_corrected_dict: Dict[int, str] = {}
            active_tasks = []

            async def process_single_page(item: Dict[str, Any]):
                page_num = item["page_number"]
                raw_txt = item["raw_text"]
                img_bytes = item["image_bytes"]
                
                try:
                    async with semaphore:
                        # Abort immediately if client disconnected
                        if await request.is_disconnected():
                            return

                        # Notify page start
                        await event_queue.put(
                            f"event: page_start\ndata: {json.dumps({'page_number': page_num, 'raw_text': raw_txt})}\n\n"
                        )

                        # Fast-Skip for already completed / restored pages
                        if page_num in skip_pages:
                            res = {
                                "success": True,
                                "corrected_text": "",
                                "model_used": "already-completed-cached",
                                "elapsed_seconds": 0.0,
                                "tokens_used": 0,
                                "error": None,
                                "already_completed": True
                            }
                        # Blank Page Fast-Skip: Check if page has no characters / is a blank scan or only an isolated number
                        elif (not raw_txt or len(raw_txt.strip()) == 0 or PDFService.is_contentless_or_blank_text(raw_txt)) and (img_bytes and PDFService.is_image_bytes_blank(img_bytes)):
                            res = {
                                "success": True,
                                "corrected_text": "",
                                "model_used": "blank-skipped",
                                "elapsed_seconds": 0.01,
                                "tokens_used": 0,
                                "error": None,
                                "is_blank": True
                            }
                            log_manager.emit(
                                level="INFO",
                                event="PAGE_SKIPPED",
                                message=f"⏩ Page {page_num} is blank or empty scan. Fast-skipping to save API quota.",
                                model="blank-skipped",
                                page_number=page_num
                            )
                        # Pure English Page Fast-Skip: Check if digital text contains only English and zero Khmer text
                        elif PDFService.is_pure_english_page(raw_txt, min_chars=35):
                            res = {
                                "success": True,
                                "corrected_text": "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]",
                                "model_used": "english-skipped",
                                "elapsed_seconds": 0.01,
                                "tokens_used": 0,
                                "error": None,
                                "is_english_skipped": True
                            }
                            log_manager.emit(
                                level="INFO",
                                event="PAGE_SKIPPED",
                                message=f"⏩ Page {page_num} contains only English text with no Khmer. Fast-skipping to focus on Khmer and save API quota.",
                                model="english-skipped",
                                page_number=page_num
                            )
                        else:
                            is_ollama_text_only = (provider == "ollama" and model and not any(v in model.lower() for v in ["vision", "vl", "llava", "minicpm", "moondream"]))

                            if mode == "vision" and not is_ollama_text_only:
                                # Multimodal Vision OCR on pre-rendered high-res image
                                res = await AIService.process_page_vision_async(
                                    image_bytes=img_bytes,
                                    page_number=page_num,
                                    provider=provider,
                                    api_key=api_key,
                                    preferred_model=model,
                                    ollama_url=ollama_url or settings.DEFAULT_OLLAMA_URL
                                )
                                # Graceful fallback: If Vision OCR failed but digital text exists, use raw text
                                if not res.get("success") and raw_txt and not res.get("corrected_text"):
                                    res["corrected_text"] = raw_txt
                                    res["model_used"] = "fallback-raw"
                            else:
                                # Digital text correction mode
                                if not raw_txt:
                                    res = {
                                        "success": True,
                                        "corrected_text": "",
                                        "model_used": "blank-skipped",
                                        "elapsed_seconds": 0.0,
                                        "tokens_used": 0,
                                        "error": None,
                                        "is_blank": True
                                    }
                                else:
                                    res = await AIService.process_page_text_async(
                                        raw_text=raw_txt,
                                        page_number=page_num,
                                        provider=provider,
                                        api_key=api_key,
                                        preferred_model=model,
                                        ollama_url=ollama_url or settings.DEFAULT_OLLAMA_URL
                                    )

                        # Check again after API call before putting to queue
                        if await request.is_disconnected():
                            return

                        all_corrected_dict[page_num] = res.get("corrected_text", "")
                        
                        # Notify page complete
                        await event_queue.put(
                            f"event: page_done\ndata: {json.dumps({'page_number': page_num, 'raw_text': raw_txt, 'corrected_text': res.get('corrected_text', ''), 'model_used': res.get('model_used', 'unknown'), 'elapsed_seconds': res.get('elapsed_seconds', 0.0), 'tokens_used': res.get('tokens_used', 0), 'success': res.get('success', False), 'error': res.get('error'), 'already_completed': res.get('already_completed', False), 'is_blank': res.get('is_blank', False)})}\n\n"
                        )
                except asyncio.CancelledError:
                    # Clean cancellation, do not emit further events or errors
                    return
                except Exception as ex:
                    logger.exception(f"Error processing page {page_num}: {ex}")
                    all_corrected_dict[page_num] = raw_txt or ""
                    await event_queue.put(
                        f"event: page_done\ndata: {json.dumps({'page_number': page_num, 'raw_text': raw_txt, 'corrected_text': raw_txt or '', 'model_used': 'error-fallback', 'elapsed_seconds': 0.0, 'tokens_used': 0, 'success': False, 'error': str(ex)})}\n\n"
                    )

            try:
                # Launch all page worker tasks and register globally
                for item in pages_bundle:
                    task = asyncio.create_task(process_single_page(item))
                    active_tasks.append(task)
                    ACTIVE_PROCESSING_TASKS.add(task)
                    task.add_done_callback(ACTIVE_PROCESSING_TASKS.discard)

                # Stream events as workers finish
                completed_count = 0
                while completed_count < selected_pages_count:
                    if await request.is_disconnected():
                        for t in active_tasks:
                            if not t.done():
                                t.cancel()
                        break

                    try:
                        event_item = await asyncio.wait_for(event_queue.get(), timeout=1.0)
                        yield event_item
                        if "event: page_done" in event_item:
                            completed_count += 1
                    except asyncio.TimeoutError:
                        if await request.is_disconnected():
                            for t in active_tasks:
                                if not t.done():
                                    t.cancel()
                            break

                # Wait for all background tasks to cleanly resolve
                await asyncio.gather(*active_tasks, return_exceptions=True)

                # Build full concatenated text in correct sequential order
                ordered_blocks = [
                    f"=== ទំព័រទី {p['page_number']} (Page {p['page_number']}) ===\n\n{all_corrected_dict.get(p['page_number'], '')}\n"
                    for p in pages_overview
                ]
                full_text = "\n".join(ordered_blocks)

                yield f"event: done\ndata: {json.dumps({'total_pages': selected_pages_count, 'full_text': full_text})}\n\n"

            finally:
                # CRITICAL: If client disconnects or aborts, cancel all remaining tasks immediately
                for t in active_tasks:
                    if not t.done():
                        t.cancel()
                    ACTIVE_PROCESSING_TASKS.discard(t)
            
        except asyncio.CancelledError:
            return
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Content-Type": "text/event-stream; charset=utf-8",
        }
    )

def transform_cloud_url(raw_url: str) -> str:
    """Transforms Google Drive, Dropbox, and cloud share links into direct downloadable URLs."""
    url = raw_url.strip()
    
    # Google Drive view link: https://drive.google.com/file/d/{FILE_ID}/view...
    gdrive_match = re.search(r'drive\.google\.com/file/d/([a-zA-Z0-9_-]+)', url)
    if gdrive_match:
        file_id = gdrive_match.group(1)
        return f"https://drive.google.com/uc?export=download&id={file_id}&confirm=t"
    
    # Google Drive open link: https://drive.google.com/open?id={FILE_ID}
    gdrive_open_match = re.search(r'drive\.google\.com/open\?id=([a-zA-Z0-9_-]+)', url)
    if gdrive_open_match:
        file_id = gdrive_open_match.group(1)
        return f"https://drive.google.com/uc?export=download&id={file_id}&confirm=t"

    # Dropbox link: dl=0 -> dl=1
    if "dropbox.com" in url and "dl=0" in url:
        return url.replace("dl=0", "dl=1")
    elif "dropbox.com" in url and "dl=1" not in url:
        return url + ("&dl=1" if "?" in url else "?dl=1")

    # If URL contains non-ascii characters in the path, safely encode them
    try:
        parsed = urllib.parse.urlsplit(url)
        quoted_path = urllib.parse.quote(urllib.parse.unquote(parsed.path))
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, quoted_path, parsed.query, parsed.fragment))
    except Exception:
        pass

    return url


def detect_pdf_language(title: str, filename: str, url: str) -> Tuple[str, bool]:
    """
    Detects if a PDF is Khmer or pure English.
    In Cambodian portals (e.g. mosvy.gov.kh), documents are Khmer by default (e.g. Prakas,
    Anukret, Royal Kram, laws, ministry circulars, and scanned reports), even when the
    filename is written in Latin transliteration (e.g. 02-Prakas-on-CTP-PF-Implementation.pdf).
    Only files that explicitly specify English versions (e.g. _Eng, _English, Eng-final) are treated as English.
    """
    combined = f"{title} {filename} {urllib.parse.unquote(url)}".lower()
    has_khmer_script = bool(re.search(r"[\u1780-\u17FF\u19E0-\u19FF]", f"{title} {filename}"))

    # 1. Any file with Khmer Unicode characters is 100% Khmer
    if has_khmer_script:
        if re.search(r"(_eng|-eng|_english|-english)\.pdf$", filename, re.I):
            return "english", False
        return "khmer", True

    # 2. Explicit English version tags in filename: e.g. _eng.pdf, -eng.pdf, _english.pdf, english-1, eng-final
    has_explicit_english = bool(
        re.search(r"(_eng|-eng|_english|-english|eng-final|full-eng|english-1)\.pdf$", filename, re.I)
        or re.search(r"(_eng|-eng|_english|-english|eng-final|full-eng|english-1)\b", combined)
        or re.search(r"(-english|_english)\.pdf$", filename, re.I)
        or "achievement-of-social-assistance" in combined
    )
    # Explicit Khmer markers & Cambodian legal terms (Prakas = ប្រកាស, Anukret = អនុក្រឹត្យ, Kram = ក្រម, etc.)
    has_explicit_khmer = bool(
        re.search(r"(_kh|-kh|_khm|-khm|_khmer|-khmer|khmer|prakas|anukret|kram|chbab|sarachor|samrech)", combined)
    )

    # If it specifies an English translation explicitly (e.g., Final-Prakas-...-English.pdf)
    if has_explicit_english and not ("_kh" in combined or "khmer" in combined or "-kh-" in combined):
        return "english", False

    # In Cambodian government portals, all other official decrees, plans, and scanned documents
    # (e.g. SP_SSW-2022-2031-Signed.pdf, 02-Prakas..., Scan_0001.pdf) are Khmer documents!
    return "khmer", True



@router.post("/fetch-url")
async def fetch_url_endpoint(request: Request):
    """
    Downloads a remote PDF or image file from a public URL or cloud share link with SSRF & size protections.
    """
    # 1. Rate Limiting Protection
    client_ip = request.client.host if request.client else "unknown"
    if not fetch_rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for URL fetch. Please wait a moment before trying again."
        )

    target_url = None
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
            target_url = body.get("url")
        except Exception:
            pass
    else:
        form = await request.form()
        target_url = form.get("url")

    if not target_url or not str(target_url).strip():
        raise HTTPException(status_code=400, detail="Please enter a valid link (URL).")

    clean_url = transform_cloud_url(str(target_url).strip())

    # 2. SSRF Protection: Validate target URL against private/internal/cloud metadata addresses
    is_safe, reason = is_safe_url(clean_url)
    if not is_safe:
        raise HTTPException(
            status_code=403,
            detail=f"Security rejection: {reason}"
        )

    # Special resolver for interior.gov.kh library detail link
    interior_hash_match = re.search(r'interior\.gov\.kh/(?:(?:kh|en)/)?library/detail/([a-zA-Z0-9_-]+)', clean_url)
    if interior_hash_match:
        doc_hash = interior_hash_match.group(1)
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
            timeout=45.0,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0",
                "Accept": "*/*",
                "Accept-Language": "km,en-US;q=0.9,en;q=0.8"
            }
        ) as client:
            resp = await client.get(clean_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to download file from link (HTTP {resp.status_code}). Please make sure the link is publicly accessible.")
            
            # Re-verify final redirected URL against SSRF
            final_url = str(resp.url)
            final_safe, final_reason = is_safe_url(final_url)
            if not final_safe:
                raise HTTPException(status_code=403, detail=f"Security rejection on redirect: {final_reason}")

            raw_content = resp.content
            if not raw_content or len(raw_content) == 0:
                raise HTTPException(status_code=400, detail="The provided link returned an empty file.")

            if len(raw_content) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"Downloaded file exceeds maximum permitted size of {settings.MAX_UPLOAD_SIZE_MB}MB."
                )

            ctype = resp.headers.get("content-type", "").lower()
            is_html = (
                "text/html" in ctype
                or raw_content[:400].lower().startswith(b"<!doctype html")
                or raw_content[:400].lower().startswith(b"<html")
                or b"<head" in raw_content[:1200].lower()
            ) and not raw_content.startswith(b"%PDF")
            # Rejection if target link is an HTML webpage rather than a PDF or image
            if is_html:
                raise HTTPException(
                    status_code=400,
                    detail="តំណភ្ជាប់នេះជាគេហទំព័រ Webpage HTML (មិនមែនជាឯកសារ PDF ឬរូបភាពទេ)។ សូមបញ្ចូលតំណភ្ជាប់ឯកសារ PDF ឬរូបភាព។ (The provided URL is an HTML webpage, not a PDF or image file. Please provide a direct PDF or image URL.)"
                )

            # Standard PDF / Image Download Handling
            content = raw_content
            cd = resp.headers.get("content-disposition", "")
            filename = None
            if "filename=" in cd:
                match = re.search(r'filename=["\']?([^"\';]+)["\']?', cd)
                if match:
                    filename = match.group(1).strip()

            if not filename:
                parsed_path = urllib.parse.urlparse(clean_url).path
                base = parsed_path.split("/")[-1].strip()
                if base and any(base.lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS):
                    filename = base

            if not filename:
                if "pdf" in ctype or content.startswith(b"%PDF"):
                    filename = "imported_document.pdf"
                elif "jpeg" in ctype or "jpg" in ctype:
                    filename = "imported_image.jpg"
                elif "png" in ctype or content.startswith(b"\x89PNG"):
                    filename = "imported_image.png"
                elif "webp" in ctype:
                    filename = "imported_image.webp"
                else:
                    filename = "imported_document.pdf"

            # Sanitize filename
            filename = sanitize_filename(filename, default="imported_document.pdf")

            # Validate magic bytes signature
            sig_valid, sig_reason = validate_file_signature(content, filename)
            if not sig_valid:
                raise HTTPException(status_code=400, detail=f"Security rejection for downloaded file: {sig_reason}")


            media_type = "application/pdf" if filename.lower().endswith(".pdf") else (ctype or "image/png")

            # Check document language if it's a PDF
            has_khmer_content = False
            is_english_only = False
            if content.startswith(b"%PDF"):
                try:
                    doc = fitz.open(stream=content, filetype="pdf")
                    pages_to_check = min(len(doc), 5)
                    extracted_text = " ".join([doc[i].get_text("text") for i in range(pages_to_check)])
                    doc.close()

                    k_count = len(re.findall(r"[\u1780-\u17D3]", extracted_text))
                    l_count = len(re.findall(r"[a-zA-Z]", extracted_text))

                    # 1. If it contains digital Khmer characters -> KHMER!
                    if k_count > 0:
                        has_khmer_content = True
                    # 2. If it contains substantial English digital text (>80 chars) and 0 Khmer -> ENGLISH!
                    elif l_count > 80 and k_count == 0:
                        is_english_only = True
                    # 3. If text is empty (scanned image PDF like SP_SSW... or 02-Prakas...) -> KHMER!
                    else:
                        lang_by_name, is_khmer_by_name = detect_pdf_language(filename, filename, clean_url)
                        if is_khmer_by_name:
                            has_khmer_content = True
                        else:
                            is_english_only = True
                except Exception:
                    pass

            doc_lang = "khmer" if has_khmer_content else ("english" if is_english_only else "unknown")

            return Response(
                content=content,
                media_type=media_type,
                headers={
                    "Content-Disposition": f'inline; filename="{filename}"',
                    "X-Filename": filename,
                    "X-Detected-Language": doc_lang,
                    "X-Has-Khmer": "true" if has_khmer_content else ("false" if is_english_only else "unknown"),
                    "Access-Control-Expose-Headers": "X-Filename, Content-Disposition, X-Detected-Language, X-Has-Khmer"
                }
            )

    except httpx.RequestError as e:
        raise HTTPException(status_code=400, detail=f"Network connection failed when downloading link: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error importing from link: {str(e)}")


