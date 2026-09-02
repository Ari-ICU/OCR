import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.config import settings
from app.services.huggingface_service import HuggingFaceService

process_page_text_hf = HuggingFaceService.process_page_text_hf
process_page_text_hf_async = HuggingFaceService.process_page_text_hf_async
process_page_vision_hf = HuggingFaceService.process_page_vision_hf
process_page_vision_hf_async = HuggingFaceService.process_page_vision_hf_async
DEFAULT_HF_API_KEY = settings.HUGGINGFACE_API_KEY
DEFAULT_TEXT_MODELS = HuggingFaceService.DEFAULT_TEXT_MODELS
DEFAULT_VISION_MODEL = HuggingFaceService.DEFAULT_VISION_MODEL
