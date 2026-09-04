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
from app.services.pdf_service import PDFService
from app.services.ai_service import AIService
from app.services.log_service import log_manager

router = APIRouter(tags=["PDF & Image Processing & Streaming"])

SUPPORTED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif")

async def parse_request_files(request: Request) -> Tuple[List[Tuple[str, bytes]], Dict[str, Any]]:
    """Robustly extracts all uploaded files and form fields from request without Pydantic type adapter issues."""
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
    
    files_data: List[Tuple[str, bytes]] = []
    for f in uploads:
        fname = f.filename or "document.pdf"
        content = await f.read()
        
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
            
        if len(content) == 0:
            raise HTTPException(status_code=400, detail=f"File '{fname}' is empty (0 bytes). Please click 'Change File' and re-select your document.")
            
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

                    all_corrected_dict[page_num] = res.get("corrected_text", "")
                    
                    # Notify page complete
                    await event_queue.put(
                        f"event: page_done\ndata: {json.dumps({'page_number': page_num, 'raw_text': raw_txt, 'corrected_text': res.get('corrected_text', ''), 'model_used': res.get('model_used', 'unknown'), 'elapsed_seconds': res.get('elapsed_seconds', 0.0), 'tokens_used': res.get('tokens_used', 0), 'success': res.get('success', False), 'error': res.get('error'), 'already_completed': res.get('already_completed', False), 'is_blank': res.get('is_blank', False)})}\n\n"
                    )
                except Exception as ex:
                    logger.exception(f"Error processing page {page_num}: {ex}")
                    all_corrected_dict[page_num] = raw_txt or ""
                    await event_queue.put(
                        f"event: page_done\ndata: {json.dumps({'page_number': page_num, 'raw_text': raw_txt, 'corrected_text': raw_txt or '', 'model_used': 'error-fallback', 'elapsed_seconds': 0.0, 'tokens_used': 0, 'success': False, 'error': str(ex)})}\n\n"
                    )

            # Launch all page worker tasks
            for item in pages_bundle:
                task = asyncio.create_task(process_single_page(item))
                active_tasks.append(task)

            # Stream events as workers finish
            completed_count = 0
            while completed_count < selected_pages_count:
                if await request.is_disconnected():
                    for t in active_tasks:
                        t.cancel()
                    break

                try:
                    event_item = await asyncio.wait_for(event_queue.get(), timeout=2.0)
                    yield event_item
                    if "event: page_done" in event_item:
                        completed_count += 1
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        for t in active_tasks:
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

    # Explicit English markers: e.g. _eng.pdf, -eng.pdf, _english.pdf, english-1, eng-final
    has_explicit_english = bool(
        re.search(r"(_eng|-eng|_english|-english|eng-final|full-eng|english-1)\b", combined)
        or "english" in combined
    )
    # Explicit Khmer markers & Cambodian legal terms (Prakas = ប្រកាស, Anukret = អនុក្រឹត្យ, Kram = ក្រម, etc.)
    has_explicit_khmer = bool(
        re.search(r"(_kh|-kh|_khm|-khm|_khmer|-khmer|khmer|prakas|anukret|kram|chbab|sarachor|samrech|cam_lv|ssw)", combined)
    )

    # If it specifies an English translation explicitly (e.g., Final-Prakas-...-English.pdf)
    if has_explicit_english and not has_khmer_script and not ("_kh" in combined or "khmer" in combined or "-kh-" in combined):
        return "english", False

    # Any file with Khmer script, Khmer tags, or legal terms like Prakas is Khmer!
    if has_khmer_script or has_explicit_khmer:
        return "khmer", True

    if has_explicit_english:
        return "english", False

    # On Cambodian domains or government portals, standard documents and scans are Khmer by default
    return "khmer", True


@router.post("/fetch-url")
async def fetch_url_endpoint(request: Request):
    """
    Downloads a remote PDF or image file from a public URL or cloud share link (e.g. Google Drive, Dropbox).
    Returns the binary content with appropriate filename headers.
    """
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
        raise HTTPException(status_code=400, detail="Please enter a valid PDF or image link (URL).")

    clean_url = transform_cloud_url(str(target_url).strip())
    
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=45.0,
            verify=False,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Language": "km,en-US;q=0.9,en;q=0.8"
            }
        ) as client:
            resp = await client.get(clean_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to download file from link (HTTP {resp.status_code}). Please make sure the link is publicly accessible.")
            
            content = resp.content
            if not content or len(content) == 0:
                raise HTTPException(status_code=400, detail="The provided link returned an empty file.")

            # Extract filename from Content-Disposition header or URL path
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

            ctype = resp.headers.get("content-type", "").lower()
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
                    if PDFService.has_khmer_text(extracted_text):
                        has_khmer_content = True
                    elif PDFService.is_english_dominant_content(extracted_text):
                        is_english_only = True
                    else:
                        # Scanned image PDF with no digital text layer (e.g. 02-Prakas-on-CTP-PF-Implementation.pdf)
                        # Check filename / metadata heuristic:
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


@router.post("/crawl-webpage")
async def crawl_webpage_endpoint(request: Request):
    """
    Crawls a single webpage link (e.g. government portal, university, blog) to automatically
    discover and extract ALL PDF links on that page or its linked document posts in parallel.
    """
    body = {}
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
        except Exception:
            pass
    else:
        form = await request.form()
        body = dict(form)

    raw_url = str(body.get("url", "")).strip().rstrip(".")
    if not raw_url:
        raise HTTPException(status_code=400, detail="Please enter a valid webpage URL.")

    clean_url = raw_url
    if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
        clean_url = "https://" + clean_url

    parsed = urllib.parse.urlparse(clean_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "km,en-US;q=0.9,en;q=0.8",
    }

    pdfs = []
    seen_pdf_urls = set()
    page_title = clean_url

    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=8.0, verify=False) as client:
        # Simultaneously fetch main webpage and CMS / WordPress Media API for maximum speed
        wp_media_url = f"{origin}/wp-json/wp/v2/media?mime_type=application/pdf&per_page=50"
        tasks = [
            client.get(clean_url),
            client.get(wp_media_url)
        ]
        resps = await asyncio.gather(*tasks, return_exceptions=True)

        main_resp = resps[0] if len(resps) > 0 and not isinstance(resps[0], Exception) and resps[0].status_code == 200 else None
        wp_resp = resps[1] if len(resps) > 1 and not isinstance(resps[1], Exception) and resps[1].status_code == 200 else None

        # 1. Process main page HTML for direct PDF links & document cards
        detail_links = []
        if main_resp:
            html = main_resp.text
            title_m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
            if title_m:
                page_title = re.sub(r'<[^>]+>', '', title_m.group(1)).strip()

            direct_links = re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
            seen_detail_urls = set()

            for href, content in direct_links:
                full_url = urllib.parse.urljoin(clean_url, href.strip())
                clean_text = re.sub(r'<[^>]+>', '', content).strip()

                if ".pdf" in full_url.lower():
                    if full_url not in seen_pdf_urls:
                        filename = urllib.parse.unquote(full_url.split("/")[-1].split("?")[0])
                        title = clean_text if len(clean_text) > 3 else filename
                        pdfs.append({"title": title, "url": full_url, "filename": filename})
                        seen_pdf_urls.add(full_url)
                else:
                    parsed_detail = urllib.parse.urlparse(full_url)
                    if (
                        parsed_detail.netloc == parsed.netloc
                        and full_url != clean_url
                        and not full_url.endswith("#")
                        and full_url not in seen_detail_urls
                    ):
                        if not any(x in full_url.lower() for x in ["/category/", "/feed", "/wp-admin", "/tag/", "/author/", "comment"]):
                            if clean_text in ["មើលឯកសារ", "ទាញយក", "Download", "View"] or len(clean_text) > 8:
                                seen_detail_urls.add(full_url)
                                detail_links.append({
                                    "url": full_url,
                                    "title": clean_text if clean_text not in ["មើលឯកសារ", "ទាញយក"] else ""
                                })

        # 2. Process WordPress Media API results
        if wp_resp:
            try:
                media_items = wp_resp.json()
                if isinstance(media_items, list):
                    for m in media_items:
                        src = m.get("source_url")
                        if src and src not in seen_pdf_urls:
                            title = m.get("title", {}).get("rendered", "")
                            filename = urllib.parse.unquote(src.split("/")[-1].split("?")[0])
                            pdfs.append({
                                "title": title or filename,
                                "url": src,
                                "filename": filename
                            })
                            seen_pdf_urls.add(src)
            except Exception:
                pass

        # 3. If fewer than 5 PDFs found, quickly inspect up to 5 document subpages
        if len(pdfs) < 5 and detail_links:
            async def fetch_subpage(item):
                try:
                    r = await client.get(item["url"], timeout=3.5)
                    sub_pdfs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', r.text, re.IGNORECASE)
                    res = []
                    for p in sub_pdfs:
                        full_pdf = urllib.parse.urljoin(item["url"], p.strip())
                        if full_pdf not in seen_pdf_urls:
                            filename = urllib.parse.unquote(full_pdf.split("/")[-1].split("?")[0])
                            title = item["title"]
                            if not title:
                                h1 = re.search(r'<h1[^>]*>(.*?)</h1>', r.text, re.DOTALL | re.IGNORECASE)
                                if h1:
                                    title = re.sub(r'<[^>]+>', '', h1.group(1)).strip()
                            if not title:
                                title = filename
                            res.append({"title": title, "url": full_pdf, "filename": filename})
                            seen_pdf_urls.add(full_pdf)
                    return res
                except Exception:
                    return []

            sub_chunks = detail_links[:5]
            sub_results = await asyncio.gather(*[fetch_subpage(item) for item in sub_chunks], return_exceptions=True)
            for sub in sub_results:
                if isinstance(sub, list):
                    pdfs.extend(sub)

    # Categorize language for all discovered PDFs
    enriched_pdfs = []
    for p in pdfs:
        lang, is_khmer = detect_pdf_language(p.get("title", ""), p.get("filename", ""), p.get("url", ""))
        enriched_pdfs.append({
            "title": p.get("title", ""),
            "url": p.get("url", ""),
            "filename": p.get("filename", ""),
            "language": lang,
            "has_khmer": is_khmer
        })

    khmer_count = sum(1 for p in enriched_pdfs if p["has_khmer"])
    english_count = sum(1 for p in enriched_pdfs if not p["has_khmer"])

    return {
        "webpage_url": clean_url,
        "webpage_title": page_title,
        "total_found": len(enriched_pdfs),
        "khmer_count": khmer_count,
        "english_count": english_count,
        "pdfs": enriched_pdfs
    }


