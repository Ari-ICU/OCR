import os
import re
import json
import time
import uuid
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import BaseModel, Field

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from app.core.config import settings
from app.core.security import sanitize_filename
from app.services.pdf_service import PDFService
from app.services.ai_service import AIService
from app.services.log_service import log_manager

router = APIRouter(prefix="/dataset", tags=["Dataset & Server-side PDF-to-TXT"])


class ConvertToTxtRequest(BaseModel):
    filename: str = Field(..., description="PDF filename in ./pdf dataset directory")
    start_page: int = Field(1, ge=1, description="Start page (1-indexed)")
    end_page: Optional[int] = Field(None, description="End page (inclusive)")
    mode: str = Field("vision", description="Conversion mode: 'vision' or 'text'")
    provider: str = Field("gemini", description="AI provider: 'gemini' or 'ollama'")
    model: Optional[str] = Field(None, description="Model override (e.g. gemini-3.7-flash)")
    dpi: int = Field(200, ge=72, le=300, description="DPI for vision OCR")
    use_ai: bool = Field(True, description="Whether to apply AI Vision/OCR correction (if False, fast text extraction)")
    save_to_txt: bool = Field(True, description="Automatically save .txt to ./txt/ on server disk")
    save_to_jsonl: bool = Field(True, description="Automatically save clean .jsonl to ./jsonl/ on server disk")


def _format_size(size_bytes: int) -> str:
    if size_bytes <= 0:
        return "0 B"
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024.0:
            return f"{size_bytes:.1f} {unit}" if unit != "B" else f"{size_bytes} B"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} GB"


def _find_matching_txt(stem: str) -> Optional[Path]:
    """Finds an existing .txt file corresponding to a PDF stem in settings.TXT_DIR."""
    txt_dir = settings.TXT_DIR
    if not txt_dir.exists():
        return None

    # 1. Exact match: stem.txt
    exact = txt_dir / f"{stem}.txt"
    if exact.exists():
        return exact

    # 2. Variants like {stem}_corrected_khmer.txt or normalized variants
    stem_norm = stem.replace(" ", "_").replace("-", "_").lower()
    for txt_path in txt_dir.glob("*.txt"):
        name_stem = txt_path.stem
        name_stem_norm = name_stem.replace(" ", "_").replace("-", "_").lower()
        if stem_norm == name_stem_norm:
            return txt_path
        if name_stem_norm.startswith(stem_norm) or stem_norm.startswith(name_stem_norm):
            return txt_path

    return None


def _find_matching_jsonl(stem: str) -> Optional[Path]:
    """Finds an existing .jsonl file corresponding to a PDF stem in settings.JSONL_DIR."""
    jsonl_dir = settings.JSONL_DIR
    if not jsonl_dir.exists():
        return None
    exact = jsonl_dir / f"{stem}.jsonl"
    if exact.exists():
        return exact
    exact_clean = jsonl_dir / f"{stem}_clean.jsonl"
    if exact_clean.exists():
        return exact_clean
    return None


@router.get("/files")
def list_dataset_files():
    """
    Lists all PDF documents in the server dataset folder (./pdf)
    along with their page counts, file sizes, and converted status (.txt and .jsonl).
    """
    pdf_dir = settings.DATASET_DIR
    if not pdf_dir.exists():
        return {
            "dataset_dir": str(pdf_dir),
            "total_files": 0,
            "converted_count": 0,
            "files": []
        }

    results = []
    pdf_files = sorted(list(pdf_dir.glob("*.pdf")), key=lambda p: p.name.lower())

    for p in pdf_files:
        try:
            stat = p.stat()
            size_bytes = stat.st_size
            mod_time = stat.st_mtime
        except Exception:
            size_bytes = 0
            mod_time = 0

        # Fast page count without rendering raster images
        page_count = 0
        try:
            doc = fitz.open(str(p))
            page_count = len(doc)
            doc.close()
        except Exception:
            page_count = 0

        # Check existing .txt and .jsonl
        txt_path = _find_matching_txt(p.stem)
        jsonl_path = _find_matching_jsonl(p.stem)

        txt_size = txt_path.stat().st_size if txt_path and txt_path.exists() else 0
        jsonl_size = jsonl_path.stat().st_size if jsonl_path and jsonl_path.exists() else 0

        results.append({
            "filename": p.name,
            "stem": p.stem,
            "size_bytes": size_bytes,
            "size_human": _format_size(size_bytes),
            "total_pages": page_count,
            "has_txt": bool(txt_path and txt_path.exists()),
            "txt_filename": txt_path.name if txt_path else None,
            "txt_size_bytes": txt_size,
            "txt_size_human": _format_size(txt_size),
            "has_jsonl": bool(jsonl_path and jsonl_path.exists()),
            "jsonl_filename": jsonl_path.name if jsonl_path else None,
            "jsonl_size_bytes": jsonl_size,
            "modified_time": mod_time
        })

    converted = sum(1 for f in results if f["has_txt"])

    return {
        "dataset_dir": str(pdf_dir),
        "txt_dir": str(settings.TXT_DIR),
        "jsonl_dir": str(settings.JSONL_DIR),
        "total_files": len(results),
        "converted_count": converted,
        "files": results
    }


@router.get("/file/{filename:path}")
def get_dataset_file(filename: str):
    """
    Safely streams a PDF document from the server dataset directory (./pdf)
    so it can be loaded directly into the workspace without manual file picking.
    """
    safe_name = sanitize_filename(filename)
    target_path = settings.DATASET_DIR / safe_name

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail=f"PDF '{safe_name}' was not found in dataset folder.")

    # Read total pages for convenience header
    total_pages = 0
    try:
        doc = fitz.open(str(target_path))
        total_pages = len(doc)
        doc.close()
    except Exception:
        pass

    return FileResponse(
        path=str(target_path),
        media_type="application/pdf",
        filename=safe_name,
        headers={
            "Content-Disposition": f'inline; filename="{safe_name}"',
            "X-Filename": safe_name,
            "X-Total-Pages": str(total_pages),
            "Access-Control-Expose-Headers": "Content-Disposition, X-Filename, X-Total-Pages"
        }
    )


@router.get("/txt/{filename:path}")
def get_dataset_txt(filename: str):
    """
    Retrieves the extracted text of a document from the server's ./txt/ folder.
    Parses '=== Page X ===' blocks into structured pages so the frontend can display them directly.
    """
    safe_stem = sanitize_filename(filename).replace(".pdf", "").replace(".txt", "")
    txt_path = _find_matching_txt(safe_stem)

    if not txt_path or not txt_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No converted text file (.txt) found on the server for '{safe_stem}'."
        )

    try:
        content = txt_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read text file: {str(e)}")

    # Parse '=== Page (\d+) ===' blocks
    page_blocks = re.split(r"=== Page (\d+) ===", content)
    pages = []

    if len(page_blocks) > 1:
        for idx in range(1, len(page_blocks), 2):
            try:
                page_num = int(page_blocks[idx].strip())
            except Exception:
                page_num = (idx // 2) + 1
            body_text = page_blocks[idx + 1].strip() if (idx + 1) < len(page_blocks) else ""
            is_blank = "[ទំព័រទទេ" in body_text or "Blank Page" in body_text
            pages.append({
                "page_number": page_num,
                "text": body_text,
                "char_count": len(body_text),
                "word_count": len(body_text.split()),
                "is_blank": is_blank
            })
    else:
        # Single block fallback
        pages.append({
            "page_number": 1,
            "text": content.strip(),
            "char_count": len(content.strip()),
            "word_count": len(content.strip().split()),
            "is_blank": False
        })

    return {
        "filename": txt_path.name,
        "pdf_stem": safe_stem,
        "total_pages": len(pages),
        "char_count": len(content),
        "txt_path": str(txt_path.relative_to(settings.BASE_DIR) if settings.BASE_DIR in txt_path.parents else txt_path),
        "content": content,
        "pages": pages
    }


@router.post("/to-txt")
async def convert_dataset_pdf_to_txt(req: ConvertToTxtRequest):
    """
    Direct Server-Side PDF-to-TXT Conversion:
    Reads the PDF directly from the server's ./pdf dataset folder,
    extracts/restores the Khmer text, automatically saves the .txt to ./txt/ and .jsonl to ./jsonl/
    on the server disk, and returns the converted text directly in the JSON response.
    """
    safe_name = sanitize_filename(req.filename)
    pdf_path = settings.DATASET_DIR / safe_name

    if not pdf_path.exists() or not pdf_path.is_file():
        raise HTTPException(status_code=404, detail=f"File '{safe_name}' does not exist in dataset folder.")

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open PDF document: {str(e)}")

    total_doc_pages = len(doc)
    start_idx = max(0, req.start_page - 1)
    end_idx = min(total_doc_pages, req.end_page) if req.end_page else total_doc_pages

    session_id = f"sess_dataset_{uuid.uuid4().hex[:8]}"
    AIService.set_active_session(session_id)

    log_manager.emit(
        level="INFO",
        event="SERVER_PDF_TO_TXT_START",
        message=f"📄 Processing dataset PDF '{safe_name}' (Pages {start_idx + 1} to {end_idx}) directly on server...",
        model=req.model or "gemini-3.7-flash"
    )

    pages_result = []
    txt_blocks = []
    jsonl_records = []

    for page_idx in range(start_idx, end_idx):
        page_num = page_idx + 1
        page = doc[page_idx]

        # Check cancellation
        if AIService.is_cancelled(session_id):
            break

        # Check if page is blank
        is_blank = PDFService.is_page_blank(page)
        if is_blank:
            clean_text = "[ទំព័រទទេ / Blank Page]"
            pages_result.append({
                "page_number": page_num,
                "raw_text": "",
                "corrected_text": clean_text,
                "is_blank": True,
                "model_used": "blank-skipped"
            })
            txt_blocks.append(f"=== Page {page_num} ===\n\n{clean_text}\n\n")
            continue

        raw_text = page.get_text("text").strip()

        if not req.use_ai:
            # Fast PyMuPDF digital text extraction
            clean_text = raw_text
            model_used = "pymupdf-direct"
        else:
            if req.mode == "vision":
                # High-res vision OCR
                img_bytes = PDFService.render_page_image_bytes(page, dpi=req.dpi)
                res = await AIService.process_page_vision_async(
                    image_bytes=img_bytes,
                    page_number=page_num,
                    provider=req.provider,
                    preferred_model=req.model,
                    session_id=session_id
                )
            else:
                # Text AI restoration
                res = await AIService.process_page_text_async(
                    raw_text=raw_text,
                    page_number=page_num,
                    provider=req.provider,
                    preferred_model=req.model,
                    session_id=session_id
                )

            clean_text = res.get("corrected_text") or raw_text
            model_used = res.get("model_used") or req.model or "gemini"

        pages_result.append({
            "page_number": page_num,
            "raw_text": raw_text,
            "corrected_text": clean_text,
            "char_count": len(clean_text),
            "word_count": len(clean_text.split()),
            "model_used": model_used
        })

        txt_blocks.append(f"=== Page {page_num} ===\n\n{clean_text}\n\n")

        # Prepare clean JSONL record
        if not is_blank and clean_text.strip():
            jsonl_records.append(json.dumps({
                "document": safe_name,
                "page": page_num,
                "doc_page": page_num,
                "text": clean_text.strip(),
                "char_count": len(clean_text.strip()),
                "word_count": len(clean_text.strip().split()),
                "model_used": model_used
            }, ensure_ascii=False))

    doc.close()

    stem = Path(safe_name).stem
    txt_save_path = None
    jsonl_save_path = None

    # Write .txt to ./txt/ on server
    if req.save_to_txt and txt_blocks:
        txt_target = settings.TXT_DIR / f"{stem}.txt"
        txt_target.write_text("".join(txt_blocks), encoding="utf-8")
        txt_save_path = str(txt_target.relative_to(settings.BASE_DIR))
        log_manager.emit(
            level="SUCCESS",
            event="SERVER_TXT_SAVED",
            message=f"💾 Saved converted text to server disk at '{txt_save_path}'.",
            model="system"
        )

    # Write .jsonl to ./jsonl/ on server
    if req.save_to_jsonl and jsonl_records:
        jsonl_target = settings.JSONL_DIR / f"{stem}.jsonl"
        jsonl_target.write_text("\n".join(jsonl_records) + "\n", encoding="utf-8")
        jsonl_save_path = str(jsonl_target.relative_to(settings.BASE_DIR))
        log_manager.emit(
            level="SUCCESS",
            event="SERVER_JSONL_SAVED",
            message=f"💾 Saved clean JSONL to server disk at '{jsonl_save_path}'.",
            model="system"
        )

    return {
        "success": True,
        "filename": safe_name,
        "stem": stem,
        "total_pages": total_doc_pages,
        "processed_count": len(pages_result),
        "txt_saved_path": txt_save_path,
        "jsonl_saved_path": jsonl_save_path,
        "pages": pages_result,
        "full_text": "".join(txt_blocks)
    }


@router.post("/to-txt-stream")
async def convert_dataset_pdf_to_txt_stream(req: ConvertToTxtRequest):
    """
    Streaming SSE version of Server-Side PDF-to-TXT:
    Streams real-time page-by-page progress, live tokens, and page cards
    while simultaneously writing .txt and .jsonl directly to the server's disk!
    """
    safe_name = sanitize_filename(req.filename)
    pdf_path = settings.DATASET_DIR / safe_name

    if not pdf_path.exists() or not pdf_path.is_file():
        raise HTTPException(status_code=404, detail=f"File '{safe_name}' does not exist in dataset folder.")

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to open PDF document: {str(e)}")

    total_doc_pages = len(doc)
    start_idx = max(0, req.start_page - 1)
    end_idx = min(total_doc_pages, req.end_page) if req.end_page else total_doc_pages
    selected_count = max(0, end_idx - start_idx)

    session_id = f"sess_dataset_stream_{uuid.uuid4().hex[:8]}"
    AIService.set_active_session(session_id)

    stem = Path(safe_name).stem
    txt_target = settings.TXT_DIR / f"{stem}.txt" if req.save_to_txt else None
    jsonl_target = settings.JSONL_DIR / f"{stem}.jsonl" if req.save_to_jsonl else None

    # Clear previous txt and jsonl for fresh overwrite
    if txt_target:
        txt_target.write_text("", encoding="utf-8")
    if jsonl_target:
        jsonl_target.write_text("", encoding="utf-8")

    async def event_generator():
        try:
            # Emit start event
            yield f"data: {json.dumps({'type': 'init', 'filename': safe_name, 'total_pages': total_doc_pages, 'selected_count': selected_count, 'start_page': start_idx + 1, 'end_page': end_idx})}\n\n"

            for page_idx in range(start_idx, end_idx):
                page_num = page_idx + 1
                page = doc[page_idx]

                if AIService.is_cancelled(session_id):
                    yield f"data: {json.dumps({'type': 'cancelled', 'message': 'Processing was stopped by user.'})}\n\n"
                    break

                yield f"data: {json.dumps({'type': 'page_start', 'page_number': page_num, 'total_pages': total_doc_pages})}\n\n"

                is_blank = PDFService.is_page_blank(page)
                thumb = PDFService.render_page_thumbnail_base64(page, dpi=75)

                if is_blank:
                    clean_text = "[ទំព័រទទេ / Blank Page]"
                    page_data = {
                        "type": "page_complete",
                        "page_number": page_num,
                        "file_name": safe_name,
                        "doc_page_number": page_num,
                        "raw_text": "",
                        "corrected_text": clean_text,
                        "is_blank": True,
                        "model_used": "blank-skipped",
                        "thumbnail": thumb,
                        "elapsed_seconds": 0.05,
                        "total_tokens": 0
                    }
                    yield f"data: {json.dumps(page_data)}\n\n"
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
                            session_id=session_id
                        )
                    else:
                        res = await AIService.process_page_text_async(
                            raw_text=raw_text,
                            page_number=page_num,
                            provider=req.provider,
                            preferred_model=req.model,
                            session_id=session_id
                        )
                    clean_text = res.get("corrected_text") or raw_text
                    model_used = res.get("model_used") or req.model or "gemini"
                    elapsed = res.get("elapsed_seconds", 1.0)
                    tokens = res.get("total_tokens", 0)

                page_data = {
                    "type": "page_complete",
                    "page_number": page_num,
                    "file_name": safe_name,
                    "doc_page_number": page_num,
                    "raw_text": raw_text,
                    "corrected_text": clean_text,
                    "char_count": len(clean_text),
                    "word_count": len(clean_text.split()),
                    "has_formulas": ("=" in clean_text or "+" in clean_text or "\\" in clean_text),
                    "model_used": model_used,
                    "thumbnail": thumb,
                    "elapsed_seconds": elapsed,
                    "total_tokens": tokens
                }
                yield f"data: {json.dumps(page_data)}\n\n"

                # Append to server disk .txt directly
                if txt_target:
                    with open(txt_target, "a", encoding="utf-8") as f:
                        f.write(f"=== Page {page_num} ===\n\n{clean_text}\n\n")

                # Append to server disk .jsonl directly
                if jsonl_target and clean_text.strip():
                    with open(jsonl_target, "a", encoding="utf-8") as f:
                        record = {
                            "document": safe_name,
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

            yield f"data: {json.dumps({'type': 'done', 'status': 'completed', 'txt_saved_path': txt_rel, 'jsonl_saved_path': jsonl_rel})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
