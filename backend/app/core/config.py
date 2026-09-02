import os
from typing import List, Dict, Any
from pydantic import BaseModel

class Settings:
    PROJECT_NAME: str = "Khmer PDF & Vision AI Engine"
    VERSION: str = "2.1.0"
    DESCRIPTION: str = "Scalable high-performance backend for Khmer PDF extraction, Vision OCR, and LaTeX formula restoration."
    
    # AI Keys & URLs
    DEFAULT_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
    HUGGINGFACE_API_KEY: str = os.environ.get("HUGGINGFACE_API_KEY", "")
    DEFAULT_OLLAMA_URL: str = os.environ.get("OLLAMA_URL", "http://localhost:11434")
    
    # Active high-performance Gemini models (Gemini 3.6 Flash is #1 Default, Gemini 3.5 Flash is Fallback)
    MODELS_TO_TRY: List[str] = ["gemini-3.6-flash", "gemini-3.5-flash"]

    MODEL_METADATA: List[Dict[str, str]] = [
        {
            "id": "gemini-3.6-flash",
            "name": "Gemini 3.6 Flash",
            "tag": "Google AI • Recommended (#1)",
            "description": "State-of-the-art multimodal vision model with exceptional Khmer OCR, subscript accuracy, and LaTeX formula generation."
        },
        {
            "id": "gemini-3.5-flash",
            "name": "Gemini 3.5 Flash",
            "tag": "Google AI • High Throughput (#2)",
            "description": "Reliable high-throughput model with strong Khmer OCR and LaTeX formula restoration."
        }
    ]

settings = Settings()

