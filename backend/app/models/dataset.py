from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class InspectUrlRequest(BaseModel):
    url: str = Field(..., description="Server store URL, API endpoint, or direct PDF link")


class DiscoveredPdfItem(BaseModel):
    url: str
    title: str
    filename: str
    source_id: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class InspectUrlResponse(BaseModel):
    is_store: bool
    url: str
    content_type: str
    title: Optional[str] = None
    filename: Optional[str] = None
    total_pdfs: int = 0
    pdfs: List[DiscoveredPdfItem] = []


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


class BatchStoreConvertToTxtRequest(BaseModel):
    store_url: Optional[str] = Field(None, description="Backend database API URL containing multiple PDFs")
    items: Optional[List[DiscoveredPdfItem]] = Field(None, description="Specific items from database store to convert")
    urls: Optional[List[str]] = Field(None, description="Explicit list of PDF URLs")
    mode: str = Field("vision", description="Conversion mode: 'vision' or 'text'")
    provider: str = Field("gemini", description="AI provider: 'gemini' or 'ollama'")
    model: Optional[str] = Field(None, description="Model override")
    dpi: int = Field(200, ge=72, le=300)
    use_ai: bool = Field(True)
    save_to_txt: bool = Field(True)
    save_to_jsonl: bool = Field(True)
    save_to_pdf_dataset: bool = Field(True)
    api_key: Optional[str] = Field(None)


class DatasetFileItem(BaseModel):
    filename: str
    stem: str
    size_bytes: int
    size_human: str
    total_pages: int
    has_txt: bool
    txt_filename: Optional[str] = None
    txt_size_bytes: int = 0
    txt_size_human: str = "0 B"
    has_jsonl: bool
    jsonl_filename: Optional[str] = None
    jsonl_size_bytes: int = 0
    modified_time: Optional[float] = None
