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
    def create_document_with_file_map(
        cls, files_data: List[Tuple[str, bytes]]
    ) -> Tuple[fitz.Document, List[Dict[str, Any]], Dict[int, Dict[str, Any]]]:
        """
        Creates a unified fitz.Document and tracks:
        1. files_summary: List of file metadata dicts with page counts and offsets
        2. page_to_file: Mapping of 1-indexed global page_number -> {"file_name": str, "doc_page_number": int}
        """
        if not files_data:
            raise ValueError("No files provided.")

        combined = fitz.open()
        files_summary: List[Dict[str, Any]] = []
        page_to_file: Dict[int, Dict[str, Any]] = {}
        current_global_page = 1

        for fname, fbytes in files_data:
            ext = fname.lower().split(".")[-1] if "." in fname else "png"
            file_start_page = current_global_page
            pages_in_file = 0

            if ext == "pdf":
                try:
                    sub_doc = fitz.open(stream=fbytes, filetype="pdf")
                    pages_in_file = len(sub_doc)
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
                    pages_in_file = 1
                except Exception as e:
                    print(f"Error inserting image {fname}: {e}")

            if pages_in_file > 0:
                for doc_p in range(1, pages_in_file + 1):
                    page_to_file[current_global_page] = {
                        "file_name": fname,
                        "doc_page_number": doc_p
                    }
                    current_global_page += 1

                files_summary.append({
                    "filename": fname,
                    "pages": pages_in_file,
                    "start_page": file_start_page,
                    "end_page": current_global_page - 1,
                    "size_bytes": len(fbytes)
                })

        if len(combined) == 0:
            raise ValueError("Could not extract any valid pages from uploaded file(s).")
        return combined, files_summary, page_to_file

    @classmethod
    def create_document_from_files_data(cls, files_data: List[Tuple[str, bytes]]) -> fitz.Document:
        """
        Creates a unified fitz.Document from one or more uploaded files (PDFs and/or images).
        If multiple images/PDFs are provided, merges them sequentially into pages 1..N.
        """
        doc, _, _ = cls.create_document_with_file_map(files_data)
        return doc

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
    def is_image_bytes_blank(image_bytes: bytes, threshold_stddev: float = 5.0) -> bool:
        """
        Detects whether an image is blank/solid background or has only a tiny page number at the bottom (e.g. '- ២៦ -')
        to skip unnecessary AI OCR and preserve API quota.
        """
        try:
            from PIL import Image, ImageStat
            img = Image.open(io.BytesIO(image_bytes)).convert("L")
            img.thumbnail((300, 400))
            
            stat = ImageStat.Stat(img)
            stddev = stat.stddev[0]
            if stddev < 3.0:
                return True
                
            # Count dark ink pixels (< 200 brightness out of 255)
            pixels = list(img.getdata())
            dark_pixels = sum(1 for p in pixels if p < 200)
            total_pixels = len(pixels)
            dark_ratio = dark_pixels / max(1, total_pixels)
            
            # If dark ink is less than 0.12% of the whole page, it's just a tiny isolated page number or empty scan
            if dark_ratio < 0.0012:
                return True
                
            return False
        except Exception:
            return False

    @staticmethod
    def is_contentless_or_blank_text(text: str) -> bool:
        """
        Detects if text has no meaningful body content (e.g., empty, or only isolated page numbers/dashes like '- ២៦ -', '41', '- ៤០ -').
        """
        if not text:
            return True
        cleaned = text.strip()
        if len(cleaned) == 0:
            return True
        
        # If total length is under 30 chars and contains only digits, dashes, brackets, symbols
        if len(cleaned) < 30:
            # Strip all symbols, whitespace, digits (Khmer & Latin)
            stripped_letters = re.sub(r"[\s\-_–—*#\d\u17E0-\u17E9\(\)\[\]\.\,\/\\|~+=:;]", "", cleaned)
            if len(stripped_letters) <= 2:
                return True
                
        return False

    @staticmethod
    def has_khmer_text(text: str) -> bool:
        """Checks if the text contains any Khmer Unicode characters (U+1780 to U+17FF or U+19E0 to U+19FF)."""
        if not text:
            return False
        return bool(re.search(r"[\u1780-\u17FF\u19E0-\u19FF]", text))

    @staticmethod
    def is_english_dominant_content(text: str) -> bool:
        """
        Returns True if the content is predominantly English with no meaningful Khmer body text
        (e.g., ASEAN Charter in English, English research papers, English bibliography/references,
        even if there are isolated Khmer numbers in the footer like '- ៤០ -').
        """
        if not text or len(text.strip()) == 0:
            return False
        
        # Count actual Khmer alphabet letters (consonants and vowels, excluding just digits)
        khmer_letters = len(re.findall(r"[\u1780-\u17D3]", text))
        latin_letters = len(re.findall(r"[a-zA-Z]", text))
        
        # If there are NO Khmer alphabet letters at all, and Latin text > 30 chars
        if khmer_letters == 0 and latin_letters > 30:
            return True
        
        # If Latin text dominates (>40 chars) and Khmer letters are minimal (< 8 chars, e.g. page numbers/header)
        if latin_letters > 40 and khmer_letters < 8:
            return True
        
        # If text is more than 85% Latin letters
        if latin_letters > 80 and (khmer_letters / max(1, latin_letters + khmer_letters)) < 0.12:
            return True
            
        return False

    @staticmethod
    def is_pure_english_page(text: str, min_chars: int = 35) -> bool:
        """
        Detects if digital text contains substantial text (>= min_chars) but zero Khmer characters
        (e.g., English abstract, English bibliography/references, English licensing page).
        """
        if not text or len(text.strip()) < min_chars:
            return False
        return PDFService.is_english_dominant_content(text)

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
        doc, files_summary, page_to_file = cls.create_document_with_file_map(files_data)
        total_pages = len(doc)
        
        start_idx = max(0, start_page - 1)
        end_idx = min(total_pages, end_page) if end_page else total_pages

        pages_data: List[Dict[str, Any]] = []
        
        math_indicators = re.compile(
            r"(=|\+|-|\/|\*|\^|\\sqrt|\\frac|[0-9]+[a-zA-Z]|[a-zA-Z][0-9]+|[\u2200-\u22FF]|[\u0370-\u03FF])"
        )
        
        first_fname = files_data[0][0] if files_data else "document"

        for i in range(start_idx, end_idx):
            page = doc[i]
            page_num = i + 1
            file_info = page_to_file.get(page_num, {"file_name": first_fname, "doc_page_number": page_num})
            text = page.get_text("text").strip()
            has_formulas = bool(math_indicators.search(text))
            render_thumb = include_thumbnails and (i - start_idx < 5 or (end_idx - start_idx) <= 5)
            thumbnail = cls.render_page_thumbnail_base64(page, dpi=72) if render_thumb else ""

            pages_data.append({
                "page_number": page_num,
                "file_name": file_info["file_name"],
                "doc_page_number": file_info["doc_page_number"],
                "raw_text": text,
                "char_count": len(text),
                "word_count": len(text.split()),
                "has_formulas": has_formulas,
                "thumbnail": thumbnail
            })
            
        if len(files_data) == 1:
            title_fallback = first_fname
        else:
            pdf_count = sum(1 for f in files_data if f[0].lower().endswith(".pdf"))
            if pdf_count == len(files_data):
                title_fallback = f"{len(files_data)} PDF Documents ({first_fname} ...)"
            elif pdf_count == 0:
                title_fallback = f"{len(files_data)} Merged Images"
            else:
                title_fallback = f"{len(files_data)} Merged Files"

        metadata = {
            "title": doc.metadata.get("title") or title_fallback,
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
            "files": files_summary,
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
