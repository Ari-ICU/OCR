import os
import json
import asyncio
import re
import html as html_lib
import urllib.parse
import httpx
import logging
import bs4
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


def extract_clean_html_article(html_content: str, url: str = "") -> Tuple[str, str, int]:
    """
    Extracts clean article title and body text paragraphs from raw HTML webpage content.
    Removes boilerplate navigation, headers, footers, sidebars, scripts, ads, and social sharing widgets.
    """
    soup = bs4.BeautifulSoup(html_content, "html.parser")

    # 1. Extract title
    title = ""
    og_title = soup.find("meta", property="og:title") or soup.find("meta", attrs={"name": "twitter:title"})
    if og_title and og_title.get("content"):
        title = og_title["content"].strip()
    if not title:
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text().strip()
    if not title:
        t_tag = soup.find("title")
        if t_tag:
            title = t_tag.get_text().strip()
    title = re.sub(r"\s+", " ", title or "Webpage Document").strip()

    # 2. Decompose clutter elements
    for el in soup(["script", "style", "nav", "header", "footer", "aside", "noscript", "iframe", "form", "button", "svg"]):
        el.decompose()

    # 3. Locate main content container
    content_container = (
        soup.find("article") or 
        soup.find("main") or 
        soup.find(attrs={"role": "main"}) or 
        soup.find(class_=re.compile(r"(entry-content|post-content|article-content|news-content|detail-content|content-body)", re.I)) or
        soup.find("body")
    )
    if not content_container:
        content_container = soup

    # 4. Extract paragraphs & headings
    blocks = []
    social_keywords = {"share", "tweet", "facebook", "telegram", "whatsapp", "pinterest", "print", "email", "subscribe"}
    
    for tag in content_container.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "li"]):
        txt = tag.get_text().strip()
        if not txt or len(txt) < 2:
            continue
        txt_lower = txt.lower()
        # Skip social sharing buttons & copyrights
        if txt_lower in social_keywords or (len(txt) < 25 and any(s in txt_lower for s in social_keywords)):
            continue
        if any(j in txt_lower for j in ["copyright ©", "all rights reserved", "terms of service", "cookie policy"]):
            continue
        if tag.name.startswith("h"):
            blocks.append(f"\n【 {txt} 】\n")
        elif tag.name == "li":
            blocks.append(f"• {txt}")
        else:
            blocks.append(txt)

    full_text = "\n\n".join(blocks)
    full_text = re.sub(r"\n{3,}", "\n\n", full_text).strip()
    
    khmer_count = len(re.findall(r"[\u1780-\u17D3]", full_text))
    return title, full_text, khmer_count


def chunk_text_into_pages(text: str, max_chars_per_page: int = 1200) -> List[str]:
    """Splits long article text into readable document pages without cutting sentences abruptly."""
    raw_paras = [p.strip() for p in text.split("\n") if p.strip()]
    if not raw_paras:
        return ["[No readable text content found on webpage]"]
        
    normalized_paras = []
    for p in raw_paras:
        if len(p) <= max_chars_per_page:
            normalized_paras.append(p)
        else:
            # Sub-split long paragraph on Khmer full stop ។ or latin punctuation
            sub_sentences = re.split(r"(?<=[។\.!\?])\s*", p)
            current_sub = ""
            for s in sub_sentences:
                if len(current_sub) + len(s) > max_chars_per_page and current_sub:
                    normalized_paras.append(current_sub.strip())
                    current_sub = s
                else:
                    current_sub += (" " if current_sub else "") + s
            if current_sub:
                normalized_paras.append(current_sub.strip())

    pages = []
    current_page = []
    current_chars = 0
    for p in normalized_paras:
        if current_chars + len(p) > max_chars_per_page and current_page:
            pages.append("\n\n".join(current_page))
            current_page = [p]
            current_chars = len(p)
        else:
            current_page.append(p)
            current_chars += len(p)
    if current_page:
        pages.append("\n\n".join(current_page))
    return pages


def build_pdf_from_html_text(title: str, text: str, source_url: str = "") -> bytes:
    """
    Constructs a pristine digital PDF document with embedded Khmer font and clean text layer.
    Each page is formatted with an aesthetic header accent and structured paragraphs.
    """
    khmer_font_candidates = [
        "/System/Library/Fonts/Supplemental/Khmer Sangam MN.ttf",
        "/System/Library/Fonts/Supplemental/Khmer MN.ttc",
        "/Library/Fonts/KhmerOS.ttf",
        "/Library/Fonts/KhmerOS_sys.ttf",
        "/usr/share/fonts/truetype/khmeros/KhmerOS.ttf"
    ]
    font_path = next((p for p in khmer_font_candidates if os.path.exists(p)), None)
    
    pages_text = chunk_text_into_pages(text, max_chars_per_page=1200)
    
    doc = fitz.open()
    for p_idx, page_body in enumerate(pages_text):
        page = doc.new_page(width=595, height=842) # A4 format
        if font_path:
            page.insert_font(fontname="khmer", fontfile=font_path)
            
        # Draw aesthetic top accent bar
        page.draw_rect(fitz.Rect(40, 30, 555, 33), color=(0.2, 0.4, 0.8), fill=(0.2, 0.4, 0.8))
        
        # Insert body text inside printable rect
        rect = fitz.Rect(50, 50, 545, 800)
        if font_path:
            page.insert_textbox(rect, page_body, fontname="khmer", fontsize=11)
        else:
            page.insert_textbox(rect, page_body, fontname="helv", fontsize=11)
            
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


@router.post("/fetch-url")
async def fetch_url_endpoint(request: Request):
    """
    Downloads a remote PDF or image file from a public URL or cloud share link (e.g. Google Drive, Dropbox),
    or crawls an HTML webpage article (Khmer news, government announcements) and converts it to a clean digital PDF.
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
        raise HTTPException(status_code=400, detail="Please enter a valid link (URL).")

    clean_url = transform_cloud_url(str(target_url).strip())

    # Special resolver for interior.gov.kh library detail link
    interior_hash_match = re.search(r'interior\.gov\.kh/(?:(?:kh|en)/)?library/detail/([a-zA-Z0-9_-]+)', clean_url)
    if interior_hash_match:
        doc_hash = interior_hash_match.group(1)
        try:
            with httpx.Client(verify=False, timeout=10.0) as temp_client:
                api_res = temp_client.get(f"https://web-api.interior.gov.kh/api/v1/public/document/{doc_hash}")
                if api_res.status_code == 200:
                    api_json = api_res.json()
                    direct_file = api_json.get("data", {}).get("file_url")
                    if direct_file:
                        clean_url = direct_file
        except Exception:
            pass

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
            
            raw_content = resp.content
            if not raw_content or len(raw_content) == 0:
                raise HTTPException(status_code=400, detail="The provided link returned an empty file.")

            ctype = resp.headers.get("content-type", "").lower()
            is_html = (
                "text/html" in ctype
                or raw_content[:400].lower().startswith(b"<!doctype html")
                or raw_content[:400].lower().startswith(b"<html")
                or b"<head" in raw_content[:1200].lower()
            ) and not raw_content.startswith(b"%PDF")

            # Handle HTML Webpage Crawling: Extract clean Khmer Unicode article and package into digital PDF
            if is_html:
                decoded_html = raw_content.decode("utf-8", errors="replace")
                web_title, clean_text, khmer_chars = extract_clean_html_article(decoded_html, clean_url)
                if not clean_text or len(clean_text.strip()) == 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Could not extract readable article text from the provided webpage link. Please check if the site requires a login or has anti-scraping protection."
                    )
                
                pdf_bytes = build_pdf_from_html_text(web_title, clean_text, clean_url)
                safe_slug = re.sub(r'[\s/\\?%*:|"<>]+', '_', web_title)[:45].strip('_')
                if not safe_slug:
                    safe_slug = "webpage_article"
                filename = f"{safe_slug}.pdf"
                
                has_khmer_content = (khmer_chars > 0)
                doc_lang = "khmer" if has_khmer_content else "english"
                encoded_fn = urllib.parse.quote(filename)
                
                return Response(
                    content=pdf_bytes,
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f"inline; filename*=UTF-8''{encoded_fn}",
                        "X-Filename": filename,
                        "X-Is-Webpage": "true",
                        "X-Webpage-Title": urllib.parse.quote(web_title),
                        "X-Khmer-Count": str(khmer_chars),
                        "X-Detected-Language": doc_lang,
                        "X-Has-Khmer": "true" if has_khmer_content else "false",
                        "Access-Control-Expose-Headers": "X-Filename, Content-Disposition, X-Detected-Language, X-Has-Khmer, X-Is-Webpage, X-Webpage-Title, X-Khmer-Count"
                    }
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error importing from link: {str(e)}")


@router.post("/crawl-html-text")
async def crawl_html_text_endpoint(request: Request):
    """
    Crawls an HTML webpage link and returns structured Khmer Unicode paragraphs and pages as JSON.
    Directly usable by Digital Text mode or external scrapers.
    """
    data = await request.json()
    url = data.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Missing required 'url' parameter.")
        
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        verify=False,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "km,en-US;q=0.9,en;q=0.8"
        }
    ) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch webpage (HTTP {resp.status_code})")
            
        web_title, clean_text, khmer_chars = extract_clean_html_article(resp.text, url)
        if not clean_text:
            raise HTTPException(status_code=400, detail="Could not extract readable article text from the webpage.")
            
        pages = chunk_text_into_pages(clean_text, max_chars_per_page=1200)
        pages_data = [
            {
                "page_number": idx + 1,
                "raw_text": p_text,
                "char_count": len(p_text),
                "word_count": len(p_text.split())
            }
            for idx, p_text in enumerate(pages)
        ]
        
        return {
            "success": True,
            "title": web_title,
            "url": url,
            "khmer_char_count": khmer_chars,
            "total_pages": len(pages_data),
            "pages": pages_data
        }


@router.api_route("/view-pdf", methods=["GET", "HEAD"])
async def view_pdf_endpoint(url: str = Query(...)):
    """
    Proxies a remote PDF link directly to browser with `Content-Type: application/pdf`
    and `Content-Disposition: inline`. This ensures modern browsers render the PDF inside
    their built-in viewer tab instead of downloading it to disk.
    """
    if not url or not url.strip():
        raise HTTPException(status_code=400, detail="Missing url parameter")
    clean_url = transform_cloud_url(url.strip())
    
    # Resolve interior.gov.kh library detail link if needed
    interior_hash_match = re.search(r'interior\.gov\.kh/(?:(?:kh|en)/)?library/detail/([a-zA-Z0-9_-]+)', clean_url)
    if interior_hash_match:
        doc_hash = interior_hash_match.group(1)
        try:
            with httpx.Client(verify=False, timeout=10.0) as temp_client:
                api_res = temp_client.get(f"https://web-api.interior.gov.kh/api/v1/public/document/{doc_hash}")
                if api_res.status_code == 200:
                    api_json = api_res.json()
                    direct_file = api_json.get("data", {}).get("file_url")
                    if direct_file:
                        clean_url = direct_file
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=45.0,
            verify=False,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*"
            }
        ) as client:
            resp = await client.get(clean_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to fetch PDF (HTTP {resp.status_code})")
            
            parsed_path = urllib.parse.urlparse(clean_url).path
            filename = parsed_path.split("/")[-1].strip() or "document.pdf"
            if not filename.lower().endswith(".pdf"):
                filename += ".pdf"
            
            return Response(
                content=resp.content,
                media_type="application/pdf",
                headers={
                    "Content-Type": "application/pdf",
                    "Content-Disposition": f'inline; filename="{filename}"',
                    "Cache-Control": "public, max-age=3600"
                }
            )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error previewing PDF: {str(e)}")


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

    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=10.0, verify=False) as client:
        # Check if target is Ministry of Interior (interior.gov.kh)
        is_interior_gov = "interior.gov.kh" in origin or "interior.gov.kh" in clean_url
        interior_tasks = []
        if is_interior_gov:
            page_title = "បណ្ណាល័យឌីជីថល ក្រសួងមហាផ្ទៃ (Ministry of Interior Digital Library)"
            detail_hash = re.search(r'library/detail/([a-zA-Z0-9_-]+)', clean_url)
            if detail_hash:
                interior_tasks = [
                    client.get(f"https://web-api.interior.gov.kh/api/v1/public/document/{detail_hash.group(1)}")
                ]
            else:
                interior_tasks = [
                    client.get("https://web-api.interior.gov.kh/api/v1/public/document?page=1&per_page=30"),
                    client.get("https://web-api.interior.gov.kh/api/v1/public/document?page=2&per_page=30")
                ]

        # Simultaneously fetch main webpage, CMS / WordPress Media API, and interior API
        wp_media_url = f"{origin}/wp-json/wp/v2/media?mime_type=application/pdf&per_page=50"
        tasks = [
            client.get(clean_url),
            client.get(wp_media_url)
        ] + interior_tasks
        resps = await asyncio.gather(*tasks, return_exceptions=True)

        main_resp = resps[0] if len(resps) > 0 and not isinstance(resps[0], Exception) and resps[0].status_code == 200 else None
        wp_resp = resps[1] if len(resps) > 1 and not isinstance(resps[1], Exception) and resps[1].status_code == 200 else None
        interior_resps = resps[2:] if is_interior_gov else []

        # 1. Process main page HTML for direct PDF links & document cards
        detail_links = []
        if main_resp:
            page_html = main_resp.text
            title_m = re.search(r'<title[^>]*>(.*?)</title>', page_html, re.IGNORECASE | re.DOTALL)
            if title_m:
                page_title = html_lib.unescape(re.sub(r'<[^>]+>', '', title_m.group(1)).strip())

            # Check for government law catalog tables (e.g. moj.gov.kh/kh/law-regular)
            if "download?key=" in page_html or "law-regular" in clean_url:
                table_rows = re.findall(r'<tr[^>]*>(.*?)</tr>', page_html, re.DOTALL | re.IGNORECASE)
                for row in table_rows:
                    cols = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
                    if len(cols) >= 5:
                        raw_id = re.sub(r'<[^>]+>', '', cols[0]).strip()
                        raw_title = re.sub(r'<[^>]+>', '', cols[1]).strip()
                        if not raw_title:
                            continue
                        
                        # Col 4: Khmer PDF download
                        kh_links = re.findall(r'href=["\']([^"\']+)["\']', cols[4])
                        if kh_links and "javascript:" not in kh_links[0]:
                            kh_url = urllib.parse.urljoin(clean_url, kh_links[0].strip())
                            if kh_url not in seen_pdf_urls:
                                fn = f"{raw_id}-{raw_title[:45].strip()}.pdf" if raw_id else f"{raw_title[:50].strip()}.pdf"
                                pdfs.append({
                                    "title": raw_title,
                                    "url": kh_url,
                                    "filename": fn
                                })
                                seen_pdf_urls.add(kh_url)

                        # Col 5: English PDF if available
                        if len(cols) >= 6:
                            en_links = re.findall(r'href=["\']([^"\']+)["\']', cols[5])
                            if en_links and "javascript:" not in en_links[0] and "lan=en" in en_links[0]:
                                en_url = urllib.parse.urljoin(clean_url, en_links[0].strip())
                                if en_url not in seen_pdf_urls:
                                    fn_en = f"{raw_id}-English.pdf" if raw_id else f"{raw_title[:45]}-English.pdf"
                                    pdfs.append({
                                        "title": f"{raw_title} (English)",
                                        "url": en_url,
                                        "filename": fn_en
                                    })
                                    seen_pdf_urls.add(en_url)

            direct_links = re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', page_html, re.DOTALL | re.IGNORECASE)
            seen_detail_urls = set()

            for href, content in direct_links:
                full_url = urllib.parse.urljoin(clean_url, href.strip())
                clean_text = html_lib.unescape(re.sub(r'<[^>]+>', '', content).strip())

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

        # 3. Process Ministry of Interior (interior.gov.kh) API results
        if is_interior_gov and interior_resps:
            for i_resp in interior_resps:
                if i_resp and not isinstance(i_resp, Exception) and getattr(i_resp, "status_code", 0) == 200:
                    try:
                        i_data = i_resp.json()
                        raw_data = i_data.get("data", {})
                        items = []
                        if isinstance(raw_data, dict):
                            if "data_item" in raw_data and isinstance(raw_data["data_item"], list):
                                items = raw_data["data_item"]
                            elif raw_data.get("file_url"):
                                items = [raw_data]
                        for it in items:
                            f_url = it.get("file_url")
                            if f_url and f_url not in seen_pdf_urls:
                                t = it.get("title") or it.get("name") or "ឯកសារក្រសួងមហាផ្ទៃ"
                                fn = urllib.parse.unquote(f_url.split("/")[-1].split("?")[0])
                                pdfs.append({
                                    "title": t,
                                    "url": f_url,
                                    "filename": fn
                                })
                                seen_pdf_urls.add(f_url)
                    except Exception:
                        pass

        # 4. Also scan HTML for any embedded full PDF URLs (e.g. web-storage or direct pdf links)
        if main_resp:
            embedded_pdfs = re.findall(r'https?://[^\s"\'<>]+\.pdf', main_resp.text, re.IGNORECASE)
            for ep in embedded_pdfs:
                clean_ep = ep.strip().rstrip(".)\",'")
                if clean_ep not in seen_pdf_urls:
                    fn = urllib.parse.unquote(clean_ep.split("/")[-1].split("?")[0])
                    pdfs.append({
                        "title": fn,
                        "url": clean_ep,
                        "filename": fn
                    })
                    seen_pdf_urls.add(clean_ep)

        # 5. Check if fewer than 5 PDFs found on moj.gov.kh: inspect book-library
        if len(pdfs) < 5 and "moj.gov.kh" in clean_url:
            try:
                moj_book_resp = await client.get("https://moj.gov.kh/kh/book-library", timeout=6.0)
                if moj_book_resp.status_code == 200:
                    book_pdfs = re.findall(r'href=["\']([^"\']+\.pdf[^"\']*)["\']', moj_book_resp.text, re.IGNORECASE)
                    for bp in book_pdfs:
                        full_bp = urllib.parse.urljoin("https://moj.gov.kh/kh/book-library", bp.strip())
                        if full_bp not in seen_pdf_urls:
                            fn_bp = urllib.parse.unquote(full_bp.split("/")[-1].split("?")[0])
                            t_bp = fn_bp.replace(".pdf", "").replace("_", " ")
                            pdfs.append({
                                "title": t_bp,
                                "url": full_bp,
                                "filename": fn_bp
                            })
                            seen_pdf_urls.add(full_bp)
            except Exception:
                pass

        # 6. If fewer than 5 PDFs found, quickly inspect up to 5 document subpages
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

        enriched_pdfs = []
        for p in pdfs:
            lang, is_khmer = detect_pdf_language(p.get("title", ""), p.get("filename", ""), p.get("url", ""))
            enriched_pdfs.append({
                **p,
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


