import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.config import settings
from app.services.ai_service import AIService

process_page_vision_async = AIService.process_page_vision_async
process_page_text_async = AIService.process_page_text_async
process_page_vision_gemini = AIService.process_page_vision_gemini
process_page_text_gemini = AIService.process_page_text_gemini
DEFAULT_API_KEY = settings.DEFAULT_API_KEY
DEFAULT_OLLAMA_URL = settings.DEFAULT_OLLAMA_URL
MODELS_TO_TRY = settings.MODELS_TO_TRY
MODEL_METADATA = settings.MODEL_METADATA
