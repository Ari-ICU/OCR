import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.pdf_service import PDFService

extract_pages_from_pdf_bytes = PDFService.extract_pages_from_pdf_bytes
render_page_image_bytes = PDFService.render_page_image_bytes
render_page_thumbnail_base64 = PDFService.render_page_thumbnail_base64
