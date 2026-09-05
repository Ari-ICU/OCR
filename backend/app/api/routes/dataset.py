import time
from pathlib import Path
from typing import List, Dict, Any
from fastapi import APIRouter
from fastapi.responses import StreamingResponse, FileResponse

from app.core.config import settings
from app.models.dataset import (
    InspectUrlRequest,
    UrlConvertToTxtRequest,
    BatchStoreConvertToTxtRequest,
    DatasetFileItem
)
from app.services.dataset_service import DatasetService

router = APIRouter(prefix="/dataset", tags=["Backend Database Store & PDF-to-TXT"])


@router.get("/file/{filename:path}")
def get_server_store_test_file(filename: str) -> FileResponse:
    """
    Lightweight endpoint to serve a PDF from the server store (./pdf) for preview/download.
    """
    return DatasetService.get_dataset_file(filename)


@router.get("/sample-database-api")
def sample_backend_database_api() -> Dict[str, Any]:
    """
    Demonstration backend database API endpoint that returns a JSON list of PDFs
    stored in the database collection.
    """
    return {
        "status": "success",
        "database": "khmer_government_records",
        "timestamp": int(time.time()),
        "total": 2,
        "data": [
            {
                "id": "rec_001",
                "title": "Binder1 Official Record",
                "category": "Administration",
                "file_url": "http://localhost:8000/api/dataset/file/1787540635_Binder1.pdf",
                "pages": 4
            },
            {
                "id": "rec_002",
                "title": "MoSVY Prakas on CTP-PF Implementation",
                "category": "Social Protection",
                "file_url": "https://mosvy.gov.kh/wp-content/uploads/2021/11/02-Prakas-on-CTP-PF-Implementation.pdf",
                "pages": 18
            }
        ]
    }


@router.post("/inspect-url")
async def inspect_server_store_url(req: InspectUrlRequest) -> Dict[str, Any]:
    """
    Inspects a remote URL to detect if it's a direct PDF, an HTML index, or a JSON database API with PDF records.
    """
    return await DatasetService.inspect_server_store_url(req)


@router.post("/url-to-txt")
async def convert_url_pdf_to_txt(req: UrlConvertToTxtRequest) -> Dict[str, Any]:
    """
    Direct Server-Side URL-to-TXT Conversion for a single PDF URL (synchronous JSON response).
    """
    return await DatasetService.convert_url_pdf_to_txt_sync(req)


@router.post("/url-to-txt-stream")
async def convert_url_pdf_to_txt_stream(req: UrlConvertToTxtRequest):
    """
    Streaming SSE version for a single PDF URL or Backend Database Store URL:
    Streams live page_start, page_done, and writes .txt and .jsonl directly to disk.
    """
    # Auto-detect if URL points to a backend database API returning multiple PDFs
    try:
        inspect_res = await DatasetService.inspect_server_store_url(InspectUrlRequest(url=req.url))
        if inspect_res.get("is_store") and inspect_res.get("pdfs"):
            batch_req = BatchStoreConvertToTxtRequest(
                items=inspect_res["pdfs"],
                mode=req.mode,
                provider=req.provider,
                model=req.model,
                dpi=req.dpi,
                use_ai=req.use_ai,
                save_to_txt=req.save_to_txt,
                save_to_jsonl=req.save_to_jsonl,
                save_to_pdf_dataset=req.save_to_pdf_dataset,
                api_key=req.api_key
            )
            return await convert_batch_store_urls_stream(batch_req)
    except Exception:
        pass

    return StreamingResponse(
        DatasetService.stream_single_url_conversion(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/batch-url-to-txt-stream")
async def convert_batch_store_urls_stream(req: BatchStoreConvertToTxtRequest):
    """
    Streaming SSE version for a Backend Database Store URL containing multiple PDFs.
    """
    return StreamingResponse(
        DatasetService.stream_batch_store_conversion(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/list", response_model=List[DatasetFileItem])
def list_dataset_files() -> List[DatasetFileItem]:
    """
    Lists all stored PDF files with metadata, status of corresponding .txt and .jsonl files.
    """
    items: List[DatasetFileItem] = []
    if not settings.DATASET_DIR.exists():
        return items

    for p in sorted(settings.DATASET_DIR.glob("*.pdf"), key=lambda x: x.stat().st_mtime, reverse=True):
        stem = p.stem
        size_bytes = p.stat().st_size
        txt_path = settings.TXT_DIR / f"{stem}.txt"
        jsonl_path = settings.JSONL_DIR / f"{stem}.jsonl"

        txt_exists = txt_path.exists()
        txt_size = txt_path.stat().st_size if txt_exists else 0

        jsonl_exists = jsonl_path.exists()
        jsonl_size = jsonl_path.stat().st_size if jsonl_exists else 0

        def _format_size(b: int) -> str:
            if b < 1024:
                return f"{b} B"
            elif b < 1024 * 1024:
                return f"{b / 1024:.1f} KB"
            return f"{b / (1024 * 1024):.1f} MB"

        items.append(
            DatasetFileItem(
                filename=p.name,
                stem=stem,
                size_bytes=size_bytes,
                size_human=_format_size(size_bytes),
                total_pages=0,  # Fast lightweight listing without full parsing
                has_txt=txt_exists,
                txt_filename=f"{stem}.txt" if txt_exists else None,
                txt_size_bytes=txt_size,
                txt_size_human=_format_size(txt_size),
                has_jsonl=jsonl_exists,
                jsonl_filename=f"{stem}.jsonl" if jsonl_exists else None,
                jsonl_size_bytes=jsonl_size,
                modified_time=p.stat().st_mtime
            )
        )
    return items
