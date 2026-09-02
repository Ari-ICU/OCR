import os
import re
import time
import base64
import asyncio
import requests
from typing import Optional, Dict, Any, List

from app.core.config import settings
from app.services.log_service import log_manager

HF_KHMER_TEXT_PROMPT_TEMPLATE = """You are an expert Khmer linguist, editor, and STEM proofreader.
Below is raw text extracted from Page {page_number} of a PDF document.

CRITICAL INSTRUCTIONS:
1. Khmer Unicode, Vowels & Subscripts:
   - Fix broken Khmer vowels (ស្រៈនិស្ស័យ ា ិ ី ឹ ឺ ុ ូ ួ ើ ឿ ៀ េ ែ ៃ ោ ៅ ំ ះ ៈ).
   - Reorder any incorrectly ordered characters into standard Unicode order (Consonant + Subscript ជើង + Vowel + Signs).
   - Restore subscript consonants (ជើង U+17D2, e.g. ្ត, ្ម, ្រ, ្ល, ្ង).
   - Strictly preserve correct spelling of proper nouns, student names, and titles (e.g. "ឆាយហេង", "សាកលវិទ្យាល័យ").
   - Fix OCR artifacts and maintain proper Khmer punctuation (។, ៗ, ៖).

2. Mathematical & Scientific Formulas:
   - Accurately preserve and format all mathematical equations, arithmetic, chemical formulas, and scientific notations using LaTeX ($...$ or $$...$$).
   - Do not garble fractions (\\frac{{a}}{{b}}), roots (\\sqrt{{x}}), superscripts, or Greek symbols.

3. Structure:
   - Strictly preserve original meaning, headings, bullet lists, numbering, and paragraph structure.

4. Output Format:
   - Output ONLY the clean, corrected Khmer text.
   - Do NOT include conversational filler, greetings, or notes.

Raw Text from Page {page_number}:
--------------------------------
{page_text}
--------------------------------
"""


class HuggingFaceService:
    API_URL = "https://router.huggingface.co/v1/chat/completions"
    DEFAULT_TEXT_MODELS: List[str] = [
        "Qwen/Qwen2.5-VL-72B-Instruct",
        "Qwen/Qwen2.5-Coder-32B-Instruct"
    ]
    DEFAULT_VISION_MODEL: str = "Qwen/Qwen2.5-VL-72B-Instruct"


    @staticmethod
    def _resolve_api_key(api_key: Optional[str] = None) -> Optional[str]:
        """Resolves and sanitizes a valid single-line Hugging Face API key."""
        key = None
        if api_key and isinstance(api_key, str):
            for candidate in api_key.splitlines():
                c = candidate.strip().strip(",;")
                if c.startswith("hf_"):
                    key = c
                    break
        if not key:
            key = (settings.HUGGINGFACE_API_KEY or "").strip()
        return key.splitlines()[0].strip() if key else None

    @classmethod
    def process_page_text_hf(
        cls,
        raw_text: str,
        page_number: int,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 150
    ) -> Dict[str, Any]:
        """Corrects raw digital Khmer text using Hugging Face Serverless API."""
        if not raw_text.strip():
            return {
                "success": True,
                "corrected_text": "",
                "model_used": "none",
                "elapsed_seconds": 0.0,
                "error": None
            }

        key = cls._resolve_api_key(api_key)
        if not key:
            return {
                "success": False,
                "corrected_text": raw_text,
                "model_used": "fallback-raw",
                "elapsed_seconds": 0.0,
                "error": "Missing Hugging Face API Token (HUGGINGFACE_API_KEY)."
            }

        start_time = time.time()
        prompt = HF_KHMER_TEXT_PROMPT_TEMPLATE.format(page_number=page_number, page_text=raw_text)
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        models_to_try = [model] if model else cls.DEFAULT_TEXT_MODELS
        last_error = None

        for current_model in models_to_try:
            if not current_model:
                continue

            log_manager.emit(
                level="INFO",
                event="API_CALL_START",
                message=f"Sending Page {page_number} to Hugging Face ({current_model})...",
                model=current_model,
                page_number=page_number
            )

            payload = {
                "model": current_model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are an expert Khmer language editor and document digitizer. "
                            "Fix all broken Khmer vowels, subscript consonants, and word ordering. "
                            "Output only the corrected text."
                        )
                    },
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 4096,
                "temperature": 0.1
            }

            for attempt in range(1, 4):
                try:
                    res = requests.post(cls.API_URL, headers=headers, json=payload, timeout=timeout)
                    if res.status_code == 200:
                        data = res.json()
                        choices = data.get("choices", [])
                        if choices and "message" in choices[0]:
                            content = choices[0]["message"].get("content", "").strip()
                            content = re.sub(r"^[ \t]*```(?:markdown|text)?\n?", "", content, flags=re.IGNORECASE)
                            content = re.sub(r"\n?[ \t]*```$", "", content)
                            content = re.sub(r"\n?-{4,}\s*$", "", content).strip()
                            elapsed = round(time.time() - start_time, 2)

                            log_manager.emit(
                                level="SUCCESS",
                                event="API_CALL_SUCCESS",
                                message=f"Page {page_number} corrected by Hugging Face ({current_model}) in {elapsed}s.",
                                model=current_model,
                                page_number=page_number
                            )

                            return {
                                "success": True,
                                "corrected_text": content,
                                "model_used": current_model,
                                "elapsed_seconds": elapsed,
                                "error": None
                            }
                    elif res.status_code == 429:
                        last_error = f"Hugging Face Rate Limit (429) on {current_model}"
                        time.sleep(2.0 * attempt)
                    elif res.status_code == 503:
                        last_error = f"Model {current_model} is currently loading on Hugging Face (503)"
                        time.sleep(3.5 * attempt)
                    else:
                        last_error = f"Hugging Face HTTP {res.status_code}: {res.text}"
                        break
                except requests.exceptions.Timeout:
                    last_error = f"Hugging Face read timeout ({timeout}s) on {current_model}"
                    log_manager.emit(
                        level="WARN",
                        event="TIMEOUT_RETRY",
                        message=f"Page {page_number} request to {current_model} timed out after {timeout}s. Retrying...",
                        model=current_model,
                        page_number=page_number
                    )
                    if attempt < 3:
                        time.sleep(2.0)
                except requests.exceptions.RequestException as e:
                    last_error = f"Network exception on {current_model}: {str(e)}"
                    if attempt < 3:
                        time.sleep(1.5 * attempt)


        elapsed = round(time.time() - start_time, 2)
        log_manager.emit(
            level="ERROR",
            event="API_CALL_FAILED",
            message=f"Hugging Face text correction failed on Page {page_number}: {last_error}",
            model="huggingface-failover",
            page_number=page_number
        )

        return {
            "success": False,
            "corrected_text": raw_text,
            "model_used": "fallback-raw",
            "elapsed_seconds": elapsed,
            "error": last_error
        }

    @classmethod
    async def process_page_text_hf_async(
        cls,
        raw_text: str,
        page_number: int,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Asynchronous wrapper for Hugging Face Khmer text correction."""
        return await asyncio.to_thread(
            cls.process_page_text_hf,
            raw_text=raw_text,
            page_number=page_number,
            api_key=api_key,
            model=model
        )

    @staticmethod
    def _optimize_image_bytes(image_bytes: bytes, max_dim: int = 1600) -> str:
        """Compresses and optimizes page image for fast vision token processing."""
        try:
            import io
            from PIL import Image
            im = Image.open(io.BytesIO(image_bytes))
            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            if max(im.size) > max_dim:
                im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=88, optimize=True)
            optimized_bytes = buf.getvalue()
            b64_str = base64.b64encode(optimized_bytes).decode("utf-8")
            return f"data:image/jpeg;base64,{b64_str}"
        except Exception:
            b64_str = base64.b64encode(image_bytes).decode("utf-8")
            return f"data:image/png;base64,{b64_str}"

    @classmethod
    def process_page_vision_hf(
        cls,
        image_bytes: bytes,
        page_number: int,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 180
    ) -> Dict[str, Any]:
        """Extracts Khmer text & LaTeX formulas from page image using Qwen 2.5 VL 72B (Hugging Face Vision)."""
        vision_model = model or cls.DEFAULT_VISION_MODEL
        key = cls._resolve_api_key(api_key)

        if not key:
            return {
                "success": False,
                "corrected_text": "",
                "model_used": vision_model,
                "elapsed_seconds": 0.0,
                "error": "Missing Hugging Face API Token (HUGGINGFACE_API_KEY)."
            }

        start_time = time.time()
        data_uri = cls._optimize_image_bytes(image_bytes)
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

        log_manager.emit(
            level="INFO",
            event="API_CALL_START",
            message=f"Sending Page {page_number} ({round(len(image_bytes)/1024, 1)} KB) to Hugging Face Vision ({vision_model})...",
            model=vision_model,
            page_number=page_number
        )


        payload = {
            "model": vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "You are an expert Khmer OCR and document digitizer. "
                                "Analyze this high-resolution page image carefully and extract all Khmer text into clean Markdown. "
                                "1. Spatial Layout: TOP header at top, main body in middle, footer at very bottom. "
                                "2. Khmer Accuracy: 100% faithful Khmer Unicode spelling (Consonant + Subscript ជើង + Vowel + Signs). "
                                "3. Convert mathematical and STEM formulas into LaTeX ($...$ or $$...$$). "
                                "4. Output ONLY the clean Markdown content with NO conversation or preamble."
                            )
                        },
                        {"type": "image_url", "image_url": {"url": data_uri}}
                    ]
                }
            ],
            "max_tokens": 4096,
            "temperature": 0.1
        }

        last_error = None
        for attempt in range(1, 4):
            try:
                res = requests.post(cls.API_URL, headers=headers, json=payload, timeout=timeout)
                if res.status_code == 200:
                    data = res.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        content = choices[0]["message"].get("content", "").strip()
                        content = re.sub(r"^[ \t]*```(?:markdown|text)?\n?", "", content, flags=re.IGNORECASE)
                        content = re.sub(r"\n?[ \t]*```$", "", content).strip()
                        elapsed = round(time.time() - start_time, 2)

                        log_manager.emit(
                            level="SUCCESS",
                            event="API_CALL_SUCCESS",
                            message=f"Page {page_number} OCR completed by Hugging Face Vision ({vision_model}) in {elapsed}s.",
                            model=vision_model,
                            page_number=page_number
                        )

                        return {
                            "success": True,
                            "corrected_text": content,
                            "model_used": vision_model,
                            "elapsed_seconds": elapsed,
                            "error": None
                        }
                elif res.status_code in (429, 503):
                    last_error = f"Hugging Face HTTP {res.status_code}: {res.text}"
                    time.sleep(2.5 * attempt)
                else:
                    last_error = f"Hugging Face HTTP {res.status_code}: {res.text}"
                    break
            except requests.exceptions.Timeout:
                last_error = f"Hugging Face Vision OCR timed out after {timeout}s on {vision_model}"
                log_manager.emit(
                    level="WARN",
                    event="TIMEOUT_RETRY",
                    message=f"Page {page_number} Vision OCR timed out after {timeout}s on {vision_model}. Retrying...",
                    model=vision_model,
                    page_number=page_number
                )
                if attempt < 3:
                    time.sleep(2.0)
            except Exception as e:
                last_error = f"Vision request exception: {str(e)}"
                if attempt < 3:
                    time.sleep(2.0 * attempt)


        elapsed = round(time.time() - start_time, 2)
        log_manager.emit(
            level="ERROR",
            event="API_CALL_FAILED",
            message=f"Hugging Face Vision OCR failed on Page {page_number}: {last_error}",
            model=vision_model,
            page_number=page_number
        )

        return {
            "success": False,
            "corrected_text": "",
            "model_used": vision_model,
            "elapsed_seconds": elapsed,
            "error": last_error
        }

    @classmethod
    async def process_page_vision_hf_async(
        cls,
        image_bytes: bytes,
        page_number: int,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Asynchronous wrapper for Hugging Face Khmer Vision OCR."""
        return await asyncio.to_thread(
            cls.process_page_vision_hf,
            image_bytes=image_bytes,
            page_number=page_number,
            api_key=api_key,
            model=model
        )
