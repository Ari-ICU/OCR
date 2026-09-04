import sys
import os

# Ensure backend directory and app package are in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app, create_app
from app.core.config import settings
from app.services.pdf_service import PDFService
from app.services.ai_service import AIService
from app.services.export_service import ExportService

# Legacy / direct exports for backwards compatibility
extract_pages_from_pdf_bytes = PDFService.extract_pages_from_pdf_bytes
render_page_image_bytes = PDFService.render_page_image_bytes
render_page_thumbnail_base64 = PDFService.render_page_thumbnail_base64

process_page_vision_async = AIService.process_page_vision_async
process_page_text_async = AIService.process_page_text_async
DEFAULT_API_KEY = settings.DEFAULT_API_KEY
DEFAULT_OLLAMA_URL = settings.DEFAULT_OLLAMA_URL
MODELS_TO_TRY = settings.MODELS_TO_TRY
MODEL_METADATA = settings.MODEL_METADATA

if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 8000))
    reload = os.environ.get("RELOAD", "false").lower() in ("true", "1", "yes")
    workers = int(os.environ.get("WORKERS", 1))
    uvicorn.run("main:app", host=host, port=port, reload=reload, workers=workers if not reload else 1)

