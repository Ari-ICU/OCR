from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class TextCorrectionRequest(BaseModel):
    text: str
    page_number: Optional[int] = 1
    api_key: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = "gemini"

class TextCorrectionResponse(BaseModel):
    success: bool
    corrected_text: str
    model_used: str
    elapsed_seconds: float
    tokens_used: Optional[int] = 0
    error: Optional[str] = None

class ReprocessPageRequest(BaseModel):
    raw_text: Optional[str] = ""
    page_number: int = 1
    api_key: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = "gemini"
    mode: Optional[str] = "vision"
    image_base64: Optional[str] = None

class ExportRequest(BaseModel):
    filename: str = "document"
    format: str = "txt"  # "txt", "md", "json"
    pages: List[Dict[str, Any]]

class PageOverview(BaseModel):
    page_number: int
    raw_text: str
    char_count: int
    word_count: int
    has_formulas: bool
    thumbnail: Optional[str] = None

class PDFPreviewResponse(BaseModel):
    total_pages: int
    selected_count: int
    metadata: Dict[str, Any]
    pages: List[PageOverview]

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    active_models: List[Dict[str, str]]
    default_model: str
