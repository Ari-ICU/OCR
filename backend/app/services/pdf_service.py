import io
import re
import base64
from typing import List, Dict, Any, Optional, Tuple

try:
    import pymupdf as fitz
except ImportError:
    import fitz


class PDFService:
    @classmethod
    def create_document_from_files_data(cls, files_data: List[Tuple[str, bytes]]) -> fitz.Document:
        """
        Creates a unified fitz.Document from one or more uploaded files (PDFs and/or images).
        If multiple images/PDFs are provided, merges them sequentially into pages 1..N.
        """
        if not files_data:
            raise ValueError("No files provided.")

        if len(files_data) == 1 and files_data[0][0].lower().endswith(".pdf"):
            return fitz.open(stream=files_data[0][1], filetype="pdf")

        combined = fitz.open()
        for fname, fbytes in files_data:
            ext = fname.lower().split(".")[-1] if "." in fname else "png"
            if ext == "pdf":
                try:
                    sub_doc = fitz.open(stream=fbytes, filetype="pdf")
                    combined.insert_pdf(sub_doc)
                    sub_doc.close()
                except Exception as e:
                    print(f"Error merging sub-pdf {fname}: {e}")
            else:
                if ext in ["jpg", "jpeg"]:
                    filetype = "jpeg"
                elif ext in ["png", "webp", "bmp", "tiff", "tif"]:
                    filetype = ext
                else:
                    filetype = "png"
                try:
                    img_sub = fitz.open(stream=fbytes, filetype=filetype)
                    rect = img_sub[0].rect
                    page = combined.new_page(width=rect.width, height=rect.height)
                    page.insert_image(rect, stream=fbytes)
                    img_sub.close()
                except Exception as e:
                    print(f"Error inserting image {fname}: {e}")

        if len(combined) == 0:
            raise ValueError("Could not extract any valid pages from uploaded file(s).")
        return combined

    @staticmethod
    def get_document_from_bytes(file_bytes: bytes, filename: str = "") -> fitz.Document:
        """Opens PDF or Image files (PNG, JPG, JPEG, WEBP, TIFF, BMP) as a fitz.Document."""
        return PDFService.create_document_from_files_data([(filename or "document.pdf", file_bytes)])

    @staticmethod
    def render_page_image_bytes(page: fitz.Page, dpi: int = 200) -> bytes:
        """Renders a PDF or image page to high-res PNG image bytes using PyMuPDF (200 DPI for sharp Khmer OCR)."""
        pix = page.get_pixmap(dpi=dpi)
        return pix.tobytes("png")

    @staticmethod
    def render_page_thumbnail_base64(page: fitz.Page, dpi: int = 80) -> str:
        """Renders a lightweight page thumbnail as a base64 data URI for UI display."""
        try:
            pix = page.get_pixmap(dpi=dpi)
            img_bytes = pix.tobytes("jpeg", jpg_quality=75)
            b64 = base64.b64encode(img_bytes).decode("utf-8")
            return f"data:image/jpeg;base64,{b64}"
        except Exception:
            return ""

    @staticmethod
    def is_image_bytes_blank(image_bytes: bytes, threshold_stddev: float = 4.5) -> bool:
        """
        Detects whether an image is blank/solid background (e.g. flyleaf, empty scan)
        to skip unnecessary AI OCR and preserve API quota.
        """
        try:
            from PIL import Image, ImageStat
            img = Image.open(io.BytesIO(image_bytes)).convert("L")
            stat = ImageStat.Stat(img)
            stddev = stat.stddev[0]
            return stddev < threshold_stddev
        except Exception:
            return False

    @staticmethod
    def is_page_blank(page: fitz.Page, threshold_stddev: float = 4.5) -> bool:
        """Determines if a PDF page is completely blank / empty."""
        try:
            text = page.get_text("text").strip()
            if len(text) > 5:
                return False
            drawings = page.get_drawings()
            if drawings and len(drawings) > 3:
                return False
            pix = page.get_pixmap(dpi=50)
            return PDFService.is_image_bytes_blank(pix.tobytes("png"), threshold_stddev=threshold_stddev)
        except Exception:
            return False


    @classmethod
    def extract_pages_from_files(
        cls,
        files_data: List[Tuple[str, bytes]],
        start_page: int = 1,
        end_page: Optional[int] = None,
        include_thumbnails: bool = True
    ) -> Dict[str, Any]:
        """
        Extracts text, metadata, and optional thumbnails from one or multiple PDF / Image files.
        Supports slicing by start_page and end_page (1-indexed).
        """
        doc = cls.create_document_from_files_data(files_data)
        total_pages = len(doc)
        
        start_idx = max(0, start_page - 1)
        end_idx = min(total_pages, end_page) if end_page else total_pages

        pages_data: List[Dict[str, Any]] = []
        
        math_indicators = re.compile(
            r"(=|\+|-|\/|\*|\^|\\sqrt|\\frac|[0-9]+[a-zA-Z]|[a-zA-Z][0-9]+|[\u2200-\u22FF]|[\u0370-\u03FF])"
        )
        
        for i in range(start_idx, end_idx):
            page = doc[i]
            page_num = i + 1
            text = page.get_text("text").strip()
            has_formulas = bool(math_indicators.search(text))
            render_thumb = include_thumbnails and (i - start_idx < 5 or (end_idx - start_idx) <= 5)
            thumbnail = cls.render_page_thumbnail_base64(page, dpi=72) if render_thumb else ""

            pages_data.append({
                "page_number": page_num,
                "raw_text": text,
                "char_count": len(text),
                "word_count": len(text.split()),
                "has_formulas": has_formulas,
                "thumbnail": thumbnail
            })
            
        first_fname = files_data[0][0] if files_data else "document"
        metadata = {
            "title": doc.metadata.get("title") or (first_fname if len(files_data) == 1 else f"{len(files_data)} Merged Images"),
            "author": doc.metadata.get("author") or "Unknown",
            "subject": doc.metadata.get("subject") or "",
            "total_pages": total_pages,
            "selected_start": start_page,
            "selected_end": end_idx
        }
        
        doc.close()
        
        return {
            "total_pages": total_pages,
            "selected_count": len(pages_data),
            "metadata": metadata,
            "pages": pages_data
        }

    @classmethod
    def extract_pages_from_pdf_bytes(
        cls,
        pdf_bytes: bytes,
        filename: str = "",
        start_page: int = 1,
        end_page: Optional[int] = None,
        include_thumbnails: bool = True
    ) -> Dict[str, Any]:
        """Convenience wrapper for a single document byte string."""
        return cls.extract_pages_from_files(
            [(filename or "document.pdf", pdf_bytes)],
            start_page=start_page,
            end_page=end_page,
            include_thumbnails=include_thumbnails
        )
