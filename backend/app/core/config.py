import os
from pathlib import Path
from typing import List, Dict, Any
from dotenv import load_dotenv

# Load .env from backend or root directory
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

class Settings:
    PROJECT_NAME: str = "Khmer PDF & Vision AI Engine"
    VERSION: str = "2.1.0"
    DESCRIPTION: str = "Scalable high-performance backend for Khmer PDF extraction, Vision OCR, and LaTeX formula restoration."
    
    # AI Keys & URLs
    DEFAULT_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
    HUGGINGFACE_API_KEY: str = os.environ.get("HUGGINGFACE_API_KEY", "")
    DEFAULT_OLLAMA_URL: str = os.environ.get("OLLAMA_URL", "http://localhost:11434")
    
    # Active high-performance Gemini models (Gemini 3.7 Flash, Gemini 3.6 Flash, and Gemini 3.5 Flash)
    MODELS_TO_TRY: List[str] = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]

    MODEL_METADATA: List[Dict[str, str]] = [
        {
            "id": "gemini-3.7-flash",
            "name": "Gemini 3.7 Flash",
            "tag": "Google AI • Hybrid Reasoning (#1)",
            "description": "Next-gen multimodal reasoning model with superior Khmer OCR, nested LaTeX formula accuracy, and STEM precision."
        },
        {
            "id": "gemini-3.6-flash",
            "name": "Gemini 3.6 Flash",
            "tag": "Google AI • High Precision (#2)",
            "description": "State-of-the-art multimodal vision model with exceptional Khmer OCR, subscript accuracy, and LaTeX formula generation."
        },
        {
            "id": "gemini-3.5-flash",
            "name": "Gemini 3.5 Flash",
            "tag": "Google AI • High Throughput (#3)",
            "description": "Reliable high-throughput model with strong Khmer OCR and LaTeX formula restoration."
        }
    ]

settings = Settings()

