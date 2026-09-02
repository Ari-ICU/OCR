from fastapi import APIRouter
from app.models.schemas import ExportRequest
from app.services.export_service import ExportService

router = APIRouter(tags=["Export"])

@router.post("/export")
def export_document(req: ExportRequest):
    """Formats and exports pages into requested format (.txt, .md, .json)."""
    return ExportService.export(
        filename=req.filename,
        format_type=req.format,
        pages=req.pages
    )
