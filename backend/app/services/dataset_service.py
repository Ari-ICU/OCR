import re
import json
import time
import uuid
import urllib.parse
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any, AsyncGenerator

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse, FileResponse

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from app.core.config import settings
from app.core.security import sanitize_filename, is_safe_url, transform_cloud_url
from app.models.dataset import (
    InspectUrlRequest,
    DiscoveredPdfItem,
    UrlConvertToTxtRequest,
    BatchStoreConvertToTxtRequest,
    DatasetFileItem
)
from app.services.pdf_service import PDFService
from app.services.ai_service import AIService


class DatasetService:
    @staticmethod
    def extract_pdfs_from_json(data: Any, base_url: str) -> List[Dict[str, Any]]:
        """
        Recursively scans any arbitrary JSON response from a backend database API
        and extracts all referenced PDF links with metadata.
        """
        discovered: List[Dict[str, Any]] = []
        seen_urls = set()

        def _is_pdf_str(val: str) -> bool:
            if not isinstance(val, str):
                return False
            clean = val.strip().lower()
            return (
                clean.endswith(".pdf")
                or ".pdf?" in clean
                or "/pdf/" in clean
                or "format=pdf" in clean
                or "type=pdf" in clean
                or "download=pdf" in clean
                or "file/pdf" in clean
            )

        def _walk(obj: Any, parent: Optional[Dict[str, Any]] = None):
            if isinstance(obj, dict):
                candidate_url = None
                url_keys = ["url", "file_url", "pdf_url", "download_url", "link", "file", "path", "src", "document_url", "uri", "href"]
                for key in url_keys:
                    val = obj.get(key)
                    if isinstance(val, str) and val.strip():
                        clean_val = val.strip()
                        if clean_val.startswith("http") or _is_pdf_str(clean_val):
                            candidate_url = clean_val
                            break

                if candidate_url:
                    abs_url = urllib.parse.urljoin(base_url, candidate_url)
                    if abs_url not in seen_urls:
                        seen_urls.add(abs_url)
                        title = None
                        title_keys = ["title", "name", "filename", "label", "doc_name", "document_name", "description", "subject", "id"]
                        for t_key in title_keys:
                            t_val = obj.get(t_key)
                            if isinstance(t_val, (str, int)) and str(t_val).strip():
                                title = str(t_val).strip()
                                break

                        if not title:
                            parsed = urllib.parse.urlparse(abs_url)
                            base = parsed.path.split("/")[-1]
                            title = urllib.parse.unquote(base) if base else f"Document_{len(discovered) + 1}"

                        pages = None
                        page_keys = ["pages", "total_pages", "page_count", "num_pages", "total_page", "pages_count", "page", "count"]
                        for p_key in page_keys:
                            p_val = obj.get(p_key)
                            if isinstance(p_val, int) and p_val > 0:
                                pages = p_val
                                break
                            elif isinstance(p_val, str) and p_val.strip().isdigit() and int(p_val.strip()) > 0:
                                pages = int(p_val.strip())
                                break

                        # If page count is not in JSON metadata, check if file exists locally in DATASET_DIR
                        if not pages:
                            url_filename = abs_url.split("/")[-1].split("?")[0]
                            local_candidate = settings.DATASET_DIR / sanitize_filename(url_filename)
                            if local_candidate.exists() and local_candidate.is_file():
                                try:
                                    with fitz.open(str(local_candidate)) as temp_doc:
                                        pages = len(temp_doc)
                                except Exception:
                                    pass

                        fn = sanitize_filename(f"{title}.pdf" if not title.lower().endswith(".pdf") else title)
                        discovered.append({
                            "url": abs_url,
                            "title": title,
                            "filename": fn,
                            "source_id": str(obj.get("id") or obj.get("_id") or len(discovered) + 1),
                            "pages": pages,
                            "extra": {k: str(v) for k, v in obj.items() if k not in url_keys and isinstance(v, (str, int, float, bool))}
                        })

                for k, v in obj.items():
                    _walk(v, parent=obj)

            elif isinstance(obj, list):
                for elem in obj:
                    if isinstance(elem, str):
                        clean_elem = elem.strip()
                        if clean_elem.startswith("http") and _is_pdf_str(clean_elem):
                            abs_url = urllib.parse.urljoin(base_url, clean_elem)
                            if abs_url not in seen_urls:
                                seen_urls.add(abs_url)
                                parsed = urllib.parse.urlparse(abs_url)
                                base = parsed.path.split("/")[-1]
                                title = urllib.parse.unquote(base) if base else f"Document_{len(discovered) + 1}"
                                fn = sanitize_filename(f"{title}.pdf" if not title.lower().endswith(".pdf") else title)
                                discovered.append({
                                    "url": abs_url,
                                    "title": title,
                                    "filename": fn,
                                    "source_id": str(len(discovered) + 1),
                                    "extra": {}
                                })
                    else:
                        _walk(elem, parent=parent)

        _walk(data)
        return discovered

    @staticmethod
    async def inspect_server_store_url(req: InspectUrlRequest) -> Dict[str, Any]:
        """
        Intelligently inspects a URL from the user:
        - If it points directly to a single PDF document, detects it.
        - If it is a backend database API endpoint returning JSON with multiple PDFs,
          recursively extracts all PDF documents and metadata.
        """
        clean_url = transform_cloud_url(req.url.strip())
        is_safe, reason = is_safe_url(clean_url)
        if not is_safe:
            raise HTTPException(status_code=403, detail=f"Security rejection: {reason}")

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=15.0,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "*/*"
                }
            ) as client:
                resp = await client.get(clean_url)
                if resp.status_code != 200:
                    raise HTTPException(status_code=400, detail=f"Failed to access URL (HTTP {resp.status_code}).")

                content_type = resp.headers.get("content-type", "").lower()
                raw_body = resp.content

                # Case A: Direct PDF file
                if "application/pdf" in content_type or raw_body.startswith(b"%PDF"):
                    cd = resp.headers.get("content-disposition", "")
                    filename = "document.pdf"
                    if "filename=" in cd:
                        match = re.search(r'filename=["\']?([^"\';]+)["\']?', cd)
                        if match:
                            filename = match.group(1).strip()
                    else:
                        parsed_path = urllib.parse.urlparse(clean_url).path
                        base = parsed_path.split("/")[-1].strip()
                        if base:
                            filename = urllib.parse.unquote(base)

                    safe_name = sanitize_filename(filename)
                    pdf_pages = None
                    try:
                        with fitz.open(stream=raw_body, filetype="pdf") as temp_doc:
                            pdf_pages = len(temp_doc)
                    except Exception:
                        pass

                    return {
                        "is_store": False,
                        "is_direct_pdf": True,
                        "url": str(resp.url),
                        "filename": safe_name,
                        "size_bytes": len(raw_body),
                        "pages": pdf_pages,
                        "total_pages": pdf_pages
                    }

                # Case B: JSON API endpoint from backend database store
                try:
                    json_data = resp.json()
                    discovered = DatasetService.extract_pdfs_from_json(json_data, str(resp.url))
                    if discovered:
                        total_store_pages = sum(d["pages"] for d in discovered if d.get("pages"))
                        return {
                            "is_store": True,
                            "store_url": str(resp.url),
                            "total_pdfs": len(discovered),
                            "total_pages": total_store_pages if total_store_pages > 0 else None,
                            "database_response_type": "json",
                            "pdfs": discovered
                        }
                    else:
                        return {
                            "is_store": False,
                            "is_direct_pdf": False,
                            "message": "URL returned valid JSON, but no PDF file links or 'url' fields were detected inside.",
                            "json_keys": list(json_data.keys()) if isinstance(json_data, dict) else f"Array of {len(json_data)}"
                        }
                except Exception:
                    pass

                # Case C: HTML page with PDF links
                html_text = resp.text
                href_matches = re.findall(r'href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\']', html_text, re.IGNORECASE)
                if href_matches:
                    discovered = []
                    seen = set()
                    for href in href_matches:
                        abs_url = urllib.parse.urljoin(str(resp.url), href.strip())
                        if abs_url not in seen:
                            seen.add(abs_url)
                            base = urllib.parse.urlparse(abs_url).path.split("/")[-1]
                            title = urllib.parse.unquote(base) if base else f"Document_{len(discovered)+1}"
                            discovered.append({
                                "url": abs_url,
                                "title": title,
                                "filename": sanitize_filename(title),
                                "source_id": str(len(discovered)+1)
                            })

                    return {
                        "is_store": True,
                        "store_url": str(resp.url),
                        "total_pdfs": len(discovered),
                        "database_response_type": "html_index",
                        "pdfs": discovered
                    }

                raise HTTPException(
                    status_code=400,
                    detail="The URL did not return a PDF file or a JSON database API containing PDF links."
                )

        except httpx.RequestError as e:
            raise HTTPException(status_code=400, detail=f"Network error when inspecting URL: {str(e)}")

    @staticmethod
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

        max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=60.0,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
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

    @staticmethod
    def get_dataset_file(filename: str) -> FileResponse:
        """Serves a stored PDF from settings.DATASET_DIR with security checks."""
        safe_name = sanitize_filename(filename)
        target_path = settings.DATASET_DIR / safe_name
        if not target_path.exists() or not target_path.is_file():
            raise HTTPException(status_code=404, detail=f"File '{safe_name}' not found.")

        ascii_name = urllib.parse.quote(safe_name)
        headers = {
            "Content-Disposition": f"inline; filename*=UTF-8''{ascii_name}"
        }
        return FileResponse(path=str(target_path), media_type="application/pdf", headers=headers)

    @staticmethod
    async def convert_url_pdf_to_txt_sync(req: UrlConvertToTxtRequest) -> Dict[str, Any]:
        """Direct Server-Side URL-to-TXT Conversion for a single PDF URL."""
        filename, content = await DatasetService.fetch_pdf_bytes_from_url(req.url)

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

    @staticmethod
    async def stream_single_url_conversion(req: UrlConvertToTxtRequest) -> AsyncGenerator[str, None]:
        """Generator for SSE streaming of single PDF URL conversion."""
        filename, content = await DatasetService.fetch_pdf_bytes_from_url(req.url)

        if req.save_to_pdf_dataset:
            pdf_path = settings.DATASET_DIR / filename
            try:
                pdf_path.write_bytes(content)
            except Exception:
                pass

        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': f'Failed to parse PDF document: {str(e)}'})}\n\n"
            return

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

            yield f"event: done\ndata: {json.dumps({'type': 'done', 'filename': filename, 'txt_saved_path': txt_rel, 'jsonl_saved_path': jsonl_rel})}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    @staticmethod
    async def stream_batch_store_conversion(req: BatchStoreConvertToTxtRequest) -> AsyncGenerator[str, None]:
        """Generator for SSE streaming of Batch Store / Multi-PDF conversion."""
        items_to_process: List[Dict[str, Any]] = []

        if req.items:
            items_to_process = [item.dict() if hasattr(item, "dict") else dict(item) for item in req.items]
        elif req.urls:
            for u in req.urls:
                fn = sanitize_filename(urllib.parse.urlparse(u).path.split("/")[-1] or "doc.pdf")
                items_to_process.append({"url": u, "title": fn, "filename": fn})
        elif req.store_url:
            inspect_res = await DatasetService.inspect_server_store_url(InspectUrlRequest(url=req.store_url))
            if inspect_res.get("is_store") and inspect_res.get("pdfs"):
                items_to_process = inspect_res["pdfs"]
            elif inspect_res.get("is_direct_pdf"):
                items_to_process = [{"url": req.store_url, "title": inspect_res["filename"], "filename": inspect_res["filename"]}]
            else:
                yield f"event: error\ndata: {json.dumps({'type': 'error', 'error': 'No PDF files found in database store URL.'})}\n\n"
                return

        if not items_to_process:
            yield f"event: error\ndata: {json.dumps({'type': 'error', 'error': 'No PDF URLs provided for batch conversion.'})}\n\n"
            return

        session_id = f"sess_batch_{uuid.uuid4().hex[:8]}"
        AIService.set_active_session(session_id)

        try:
            yield f"event: store_init\ndata: {json.dumps({'type': 'store_init', 'total_documents': len(items_to_process), 'documents': items_to_process})}\n\n"

            global_page_counter = 0

            for doc_idx, doc_item in enumerate(items_to_process):
                if AIService.is_cancelled(session_id):
                    yield f"event: cancelled\ndata: {json.dumps({'type': 'cancelled', 'message': 'Processing was stopped.'})}\n\n"
                    break

                target_url = doc_item["url"]
                doc_title = doc_item.get("title") or f"Doc_{doc_idx + 1}"

                try:
                    filename, content = await DatasetService.fetch_pdf_bytes_from_url(target_url)
                except Exception as e:
                    yield f"event: doc_error\ndata: {json.dumps({'type': 'doc_error', 'doc_index': doc_idx + 1, 'url': target_url, 'error': str(e)})}\n\n"
                    continue

                if req.save_to_pdf_dataset:
                    try:
                        (settings.DATASET_DIR / filename).write_bytes(content)
                    except Exception:
                        pass

                try:
                    doc = fitz.open(stream=content, filetype="pdf")
                except Exception as e:
                    yield f"event: doc_error\ndata: {json.dumps({'type': 'doc_error', 'doc_index': doc_idx + 1, 'filename': filename, 'error': str(e)})}\n\n"
                    continue

                doc_total_pages = len(doc)
                stem = Path(filename).stem
                txt_target = settings.TXT_DIR / f"{stem}.txt" if req.save_to_txt else None
                jsonl_target = settings.JSONL_DIR / f"{stem}.jsonl" if req.save_to_jsonl else None

                if txt_target:
                    txt_target.write_text("", encoding="utf-8")
                if jsonl_target:
                    jsonl_target.write_text("", encoding="utf-8")

                yield f"event: doc_start\ndata: {json.dumps({'type': 'doc_start', 'doc_index': doc_idx + 1, 'filename': filename, 'title': doc_title, 'total_pages': doc_total_pages})}\n\n"

                for page_idx in range(doc_total_pages):
                    if AIService.is_cancelled(session_id):
                        break

                    global_page_counter += 1
                    page_num = page_idx + 1
                    page = doc[page_idx]

                    yield f"event: page_start\ndata: {json.dumps({'type': 'page_start', 'page_number': global_page_counter, 'doc_page_number': page_num, 'total_pages': doc_total_pages, 'file_name': filename})}\n\n"

                    is_blank = PDFService.is_page_blank(page)
                    thumb = PDFService.render_page_thumbnail_base64(page, dpi=75)

                    if is_blank:
                        clean_text = "[ទំព័រទទេ / Blank Page]"
                        page_data = {
                            "type": "page_done",
                            "page_number": global_page_counter,
                            "doc_page_number": page_num,
                            "file_name": filename,
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
                        "page_number": global_page_counter,
                        "doc_page_number": page_num,
                        "file_name": filename,
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

                yield f"event: doc_done\ndata: {json.dumps({'type': 'doc_done', 'doc_index': doc_idx + 1, 'filename': filename, 'txt_saved_path': txt_rel, 'jsonl_saved_path': jsonl_rel})}\n\n"

            yield f"event: done\ndata: {json.dumps({'type': 'done', 'status': 'completed', 'total_documents_processed': len(items_to_process)})}\n\n"

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
