from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class PageOverview(BaseModel):
    page_number: int
    raw_text: str
    char_count: int
    word_count: int
    has_formulas: bool
    thumbnail: Optional[str] = None


class FileBreakdownItem(BaseModel):
    filename: str
    pages: int
    start_page: Optional[int] = 1
    end_page: Optional[int] = None
    size_bytes: Optional[int] = None


class PDFPreviewResponse(BaseModel):
    total_pages: int
    selected_count: int
    metadata: Dict[str, Any]
    pages: List[PageOverview]
    files_breakdown: Optional[List[FileBreakdownItem]] = None


class ExtractPreviewQuery(BaseModel):
    start_page: int = Field(1, ge=1)
    end_page: Optional[int] = Field(None, ge=1)
