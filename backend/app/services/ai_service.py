import os
import re
import time
import json
import base64
import asyncio
import requests
from typing import Optional, List, Dict, Any
from google import genai
from google.genai import types

from app.core.config import settings
from app.services.log_service import log_manager
from app.services.key_manager import key_pool
from app.services.huggingface_service import HuggingFaceService


KHMER_VISION_PROMPT = r"""You are an expert Khmer OCR, document digitizer, and computational linguist.
Analyze this high-resolution page image carefully and extract all contents into clean, perfectly structured Markdown:

CRITICAL INSTRUCTIONS:
1. Strict Document Fidelity (Zero Hallucination):
   - Extract ONLY text that is actually present in this page image.
   - NEVER invent, assume, or add institution names, university headers, student names, author lines, or advisor titles if they do not exist on this specific page.

2. Spatial Layout & Reading Order (Top to Bottom):
   - HEADER: If the page has a top header, chapter title, or running header, place it at the very top. (If no header exists, do not add one).
   - MAIN BODY: Section headings, body paragraphs, bullet points, data tables, charts, and footnotes belong in the middle body in exact logical reading order.
   - FOOTER: If the page has running footers, author signatures, or page numbers at the bottom, place them at the very BOTTOM (last line) of the output. (If no footer exists, do not add one).

3. Khmer Orthography, Unicode & Precision:
   - Accurately read all Khmer words with 100% faithful spelling.
   - Fix broken Unicode sequences into standard Khmer Unicode order (Consonant + Subscript ជើង + Dependent Vowel + Diacritics).
   - Restore subscript consonants (ជើង U+17D2, e.g. ្ត, ្ម, ្រ, ្ល, ្ង, ្ធ, ្ញ).
   - Ensure proper vowel positioning (e.g. preposition "នៃ", not misplaced "ៃន").
   - Fix common OCR misrecognitions (e.g. "ជាពិសេស", "ថាមាន", "ជាប់", "ភាពរឹងមាំ").
   - Prevent phantom character insertions inside compound words.

4. Mathematical & STEM Formatting:
   - Convert all mathematical formulas, equations, percentages ($...$), scientific notations, fractions (\frac{a}{b}), roots, matrices, and variables into clean LaTeX ($...$ for inline or $$...$$ for block).

5. Tables & Formatting:
   - Output tables in clean Markdown format with aligned columns.
   - Preserve bullet points, numbering hierarchy, and bold formatting.

6. Output Format:
   - Output ONLY the clean Markdown content of this page.
   - Do NOT include conversational commentary, notes, or introductions.
"""

KHMER_TEXT_PROMPT_TEMPLATE = """You are an expert Khmer linguist, academic editor, and STEM proofreader.
Below is raw digital text extracted from Page {page_number} of a PDF document.

CRITICAL INSTRUCTIONS:
1. Strict Fidelity (Zero Hallucination):
   - Fix and restore ONLY the content provided below.
   - NEVER invent or inject headers, university names, author lines, or titles that are not present in this raw text.

2. Spatial Layout & Structure:
   - If the text contains top header lines, place them at the top.
   - If the text contains footer lines or page numbers, place them at the very bottom.
   - Keep all headings, paragraphs, bullet lists, and tables in original logical reading order.

3. Khmer Unicode, Orthography & Spelling:
   - Fix all scrambled or broken Khmer Unicode sequences (Consonant + ជើង + Vowel + Signs).
   - Fix broken vowels, misplaced vowels (e.g. "នៃ", not "ៃន"), and common OCR/font corruption.
   - Preserve correct spelling of all proper nouns, terms, and names actually in the text.

4. STEM & Tables:
   - Format numbers, formulas, and math into clean LaTeX ($...$ or $$...$$).
   - Format tables cleanly in Markdown syntax.

5. Output Format:
   - Output ONLY the clean, corrected Khmer Markdown text.
   - Do NOT include conversational filler, greetings, or explanations.

Raw Text from Page {page_number}:
--------------------------------
{page_text}
--------------------------------
"""


def format_clean_error(raw_error: str, key_alias: str, model_name: str) -> str:
    """Parses noisy Google API JSON exceptions into clean, informative diagnostic messages."""
    if not raw_error:
        return "Unknown error"
    
    if "503" in raw_error or "UNAVAILABLE" in raw_error or "high demand" in raw_error.lower():
        return f"[{key_alias}] ⚠️ Google Server Overload (503 High Demand on '{model_name}'). Google's servers for this model are temporarily at capacity."

    if "429" in raw_error or "RESOURCE_EXHAUSTED" in raw_error or "quota" in raw_error.lower():
        if "limit: 20" in raw_error or "GenerateRequestsPerDayPerProjectPerModel" in raw_error:
            return f"[{key_alias}] ⚠️ Free-tier Daily Project Limit (20 RPD cap on '{model_name}') reached. Automatically switching to high-throughput models..."
        
        match = re.search(r"retry in (\d+\.?\d*)s", raw_error, re.IGNORECASE)
        retry_msg = f" (Retry in {match.group(1)}s)" if match else ""
        return f"[{key_alias}] 429 Rate Limit hit on model '{model_name}'.{retry_msg}"
        
    return f"[{key_alias}] {raw_error[:140]}"


import threading

class AIService:
    _model_cooldowns: Dict[str, float] = {}
    _model_lock = threading.Lock()
    _ollama_lock = threading.Lock()

    @classmethod
    def mark_model_cooldown(cls, model_name: str, duration: float = 60.0):
        """Temporarily marks an overloaded model (503) on cooldown so other pages skip it."""
        with cls._model_lock:
            cls._model_cooldowns[model_name] = time.time() + duration

    @classmethod
    def get_prioritized_models(cls, preferred_model: Optional[str] = None) -> List[str]:
        """Returns models with healthy ones prioritized and overloaded models pushed to the end."""
        now = time.time()
        candidates = [preferred_model] if preferred_model else []
        for m in settings.MODELS_TO_TRY:
            if m not in candidates:
                candidates.append(m)

        with cls._model_lock:
            active = [m for m in candidates if cls._model_cooldowns.get(m, 0) <= now]
            cooling = [m for m in candidates if cls._model_cooldowns.get(m, 0) > now]
            return active + cooling if active else candidates

    @staticmethod
    def get_gemini_client(api_key: Optional[str] = None) -> genai.Client:
        key = api_key or settings.DEFAULT_API_KEY
        os.environ["GEMINI_API_KEY"] = key
        return genai.Client(api_key=key)

    @classmethod
    def process_page_vision_gemini(
        cls,
        image_bytes: bytes,
        page_number: int,
        api_key: Optional[str] = None,
        preferred_model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Processes rendered page image using Gemini Multimodal Vision API
        with multi-key pool rotation, live logging & instant 429 auto-failover.
        """
        start_time = time.time()
        models = cls.get_prioritized_models(preferred_model)
        candidate_keys = key_pool.get_candidate_keys(api_key)
        if not candidate_keys:
            err_msg = "No Gemini API Key provided. Please enter your Gemini API Key in the Settings panel."
            log_manager.emit(
                level="ERROR",
                event="API_CALL_FAILED",
                message=f"Vision OCR on Page {page_number} failed: {err_msg}",
                model=models[0],
                page_number=page_number
            )
            return {
                "success": False,
                "corrected_text": "",
                "model_used": models[0],
                "elapsed_seconds": 0.0,
                "error": err_msg
            }

        last_error = None
        last_alias = "Primary Key"
        tried_keys: List[str] = []
        tried_aliases: List[str] = []

        log_manager.emit(
            level="INFO",
            event="API_CALL_START",
            message=f"Starting Vision OCR on Page {page_number} ({len(image_bytes)/1024:.1f} KB image)...",
            model=models[0],
            page_number=page_number,
            details={"image_size_kb": round(len(image_bytes)/1024, 1)}
        )

        max_attempts = max(8, len(candidate_keys) + 1) if candidate_keys else 8
        for model_name in models:
            for attempt in range(1, max_attempts + 1):
                current_key, key_alias, pool_size = key_pool.get_next_key(user_keys_raw=api_key, exclude_keys=tried_keys)
                last_alias = key_alias
                if key_alias not in tried_aliases:
                    tried_aliases.append(key_alias)

                client = cls.get_gemini_client(current_key)

                try:
                    try:
                        call_start = time.time()
                        response = client.models.generate_content(
                            model=model_name,
                            contents=[
                                types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                                KHMER_VISION_PROMPT
                            ]
                        )
                        if response.text:
                            elapsed = round(time.time() - start_time, 2)
                            char_count = len(response.text.strip())
                            
                            # Extract exact tokens from Gemini usage metadata
                            tokens_used = 0
                            if hasattr(response, "usage_metadata") and response.usage_metadata:
                                tokens_used = getattr(response.usage_metadata, "total_token_count", 0) or (
                                    getattr(response.usage_metadata, "prompt_token_count", 0) + getattr(response.usage_metadata, "candidates_token_count", 0)
                                )
                            if not tokens_used:
                                tokens_used = max(10, round(char_count * 0.4) + 400)

                            if current_key:
                                key_pool.mark_success(current_key)
                                key_pool.record_key_tokens(current_key, tokens_used)

                            log_manager.emit(
                                level="SUCCESS",
                                event="API_CALL_SUCCESS",
                                message=f"Page {page_number} Vision OCR completed with {model_name} [{key_alias}] in {elapsed}s ({char_count} chars, {tokens_used} tokens).",
                                model=model_name,
                                page_number=page_number,
                                details={"latency_seconds": elapsed, "output_chars": char_count, "tokens_used": tokens_used, "key_alias": key_alias}
                            )

                            return {
                                "success": True,
                                "corrected_text": response.text.strip(),
                                "model_used": model_name,
                                "elapsed_seconds": elapsed,
                                "tokens_used": tokens_used,
                                "error": None
                            }
                    finally:
                        key_pool.release_key(current_key)
                except Exception as e:
                    last_error = str(e)
                    is_invalid_key = (
                        ("401" in last_error or "UNAUTHENTICATED" in last_error or "ACCOUNT_STATE_INVALID" in last_error or "deleted or disabled" in last_error.lower())
                        or ("403" in last_error and "suspended" in last_error.lower())
                        or ("api_key_invalid" in last_error.lower() or "api key not valid" in last_error.lower())
                    )

                    if is_invalid_key and current_key:
                        key_pool.mark_invalid(current_key)
                        tried_keys.append(current_key)
                        log_manager.emit(
                            level="WARN",
                            event="KEY_SUSPENDED_EVICTED",
                            message=f"⛔ [Invalid Key] {key_alias} was rejected by Google (unauthenticated/deleted). Skipping this key and using next key for Page {page_number}...",
                            model=model_name,
                            page_number=page_number,
                            details={"key_alias": key_alias, "action": "instant_failover_evict"}
                        )
                        continue

                    is_rate_limit = ("429" in last_error or "RESOURCE_EXHAUSTED" in last_error or "quota" in last_error.lower() or "permission_denied" in last_error.lower())
                    
                    if is_rate_limit:
                        match = re.search(r"retry in (\d+\.?\d*)s", last_error, re.IGNORECASE)
                        wait_time = float(match.group(1)) + 1.0 if match else 30.0
                        err_lower = last_error.lower()
                        is_daily = ("limit: 20" in err_lower or "generaterequestsperday" in err_lower) and "generaterequestsperminute" not in err_lower and "perminute" not in err_lower

                        if current_key:
                            key_pool.mark_rate_limited(current_key, cooldown_seconds=wait_time, is_daily=is_daily)
                            tried_keys.append(current_key)

                        has_other_keys = (pool_size > 1 and len(set(tried_keys)) < pool_size)
                        if has_other_keys:
                            if is_daily:
                                rate_msg = f"⚡ [Daily Cap (20/day) Reached] {key_alias} on '{model_name}'. Rotating to next replacement key for Page {page_number}..."
                            else:
                                rate_msg = f"🔄 [Key Pacing Cooldown ({int(wait_time)}s)] {key_alias} on '{model_name}'. Instant Failover to next key in pool for Page {page_number}..."
                            
                            log_manager.emit(
                                level="RATE_LIMIT",
                                event="RATE_LIMIT_HIT",
                                message=rate_msg,
                                model=model_name,
                                page_number=page_number,
                                details={"attempt": attempt, "key_alias": key_alias, "action": "instant_failover"}
                            )
                            time.sleep(1.2)  # Safe spacing before leasing next key in pool
                            continue
                        else:
                            sleep_duration = min(wait_time, 20.0)
                            log_manager.emit(
                                level="RATE_LIMIT",
                                event="RATE_LIMIT_HIT",
                                message=f"⏳ [Key Pool Busy] All {pool_size} key(s) are cooling down for '{model_name}'. Pausing {sleep_duration:.0f}s before retry for Page {page_number}...",
                                model=model_name,
                                page_number=page_number,
                                details={"attempt": attempt, "wait_seconds": sleep_duration, "keys_tried": tried_aliases}
                            )
                            time.sleep(sleep_duration)
                            tried_keys.clear()
                    else:
                        is_503 = ("503" in last_error or "UNAVAILABLE" in last_error or "high demand" in last_error.lower())
                        log_manager.emit(
                            level="WARN",
                            event="RETRY_ATTEMPT",
                            message=f"Page {page_number} attempt {attempt} on {model_name} [{key_alias}] failed: {last_error[:120]}...",
                            model=model_name,
                            page_number=page_number,
                            details={"attempt": attempt, "error": last_error, "key_alias": key_alias}
                        )
                        if is_503:
                            # 503 is a server-side capacity issue with this specific model; mark cooldown & switch model immediately to save keys
                            cls.mark_model_cooldown(model_name, duration=90.0)
                            fallback_name = models[1] if len(models) > 1 else "fallback model"
                            log_manager.emit(
                                level="WARN",
                                event="MODEL_OVERLOAD_SWITCH",
                                message=f"🔄 [Google Server Overload (503)] '{model_name}' is busy. Automatically switching Page {page_number} to fallback model '{fallback_name}'...",
                                model=model_name,
                                page_number=page_number
                            )
                            time.sleep(1.5)  # Backoff before switching model
                            break
                        if attempt < 4:
                            time.sleep(1.0 * attempt)

            log_manager.emit(
                level="WARN",
                event="FALLBACK_MODEL_TRIGGERED",
                message=f"All attempts on '{model_name}' exhausted for Page {page_number}. Triggering fallback model...",
                model=model_name,
                page_number=page_number
            )

        elapsed = round(time.time() - start_time, 2)
        clean_err = format_clean_error(last_error, last_alias, models[-1])
        log_manager.emit(
            level="ERROR",
            event="API_CALL_FAILED",
            message=f"Vision OCR on Page {page_number} failed across keys [{', '.join(set(tried_aliases))}]. Reason: {clean_err}",
            model=preferred_model or settings.MODELS_TO_TRY[0],
            page_number=page_number,
            details={"error": last_error, "keys_tried": tried_aliases}
        )

        return {
            "success": False,
            "corrected_text": "",
            "model_used": preferred_model or settings.MODELS_TO_TRY[0],
            "elapsed_seconds": elapsed,
            "error": clean_err
        }

    @classmethod
    def process_page_text_gemini(
        cls,
        raw_text: str,
        page_number: int,
        api_key: Optional[str] = None,
        preferred_model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Corrects raw digital Khmer text using Gemini API
        with multi-key pool rotation, live logging & instant 429 auto-failover.
        """
        if not raw_text.strip():
            return {
                "success": True,
                "corrected_text": "",
                "model_used": "none",
                "elapsed_seconds": 0.0,
                "tokens_used": 0,
                "error": None
            }

        start_time = time.time()
        models = cls.get_prioritized_models(preferred_model)
        candidate_keys = key_pool.get_candidate_keys(api_key)
        if not candidate_keys:
            err_msg = "No Gemini API Key provided. Please enter your Gemini API Key in the Settings panel."
            log_manager.emit(
                level="ERROR",
                event="API_CALL_FAILED",
                message=f"Text correction on Page {page_number} failed: {err_msg}",
                model=models[0],
                page_number=page_number
            )
            return {
                "success": False,
                "corrected_text": raw_text,
                "model_used": "fallback-raw",
                "elapsed_seconds": 0.0,
                "error": err_msg
            }

        prompt = KHMER_TEXT_PROMPT_TEMPLATE.format(page_number=page_number, page_text=raw_text)

        last_error = None
        last_alias = "Primary Key"
        tried_keys: List[str] = []
        tried_aliases: List[str] = []

        log_manager.emit(
            level="INFO",
            event="API_CALL_START",
            message=f"Starting Gemini text correction on Page {page_number} ({len(raw_text)} chars)...",
            model=models[0],
            page_number=page_number,
            details={"text_length": len(raw_text)}
        )

        max_attempts = max(8, len(candidate_keys) + 1) if candidate_keys else 8
        for model_name in models:
            for attempt in range(1, max_attempts + 1):
                current_key, key_alias, pool_size = key_pool.get_next_key(user_keys_raw=api_key, exclude_keys=tried_keys)
                last_alias = key_alias
                if key_alias not in tried_aliases:
                    tried_aliases.append(key_alias)

                client = cls.get_gemini_client(current_key)

                try:
                    try:
                        call_start = time.time()
                        response = client.models.generate_content(
                            model=model_name,
                            contents=prompt
                        )
                        if response.text:
                            elapsed = round(time.time() - start_time, 2)
                            char_count = len(response.text.strip())
                            
                            # Extract exact tokens from Gemini usage metadata
                            tokens_used = 0
                            if hasattr(response, "usage_metadata") and response.usage_metadata:
                                tokens_used = getattr(response.usage_metadata, "total_token_count", 0) or (
                                    getattr(response.usage_metadata, "prompt_token_count", 0) + getattr(response.usage_metadata, "candidates_token_count", 0)
                                )
                            if not tokens_used:
                                tokens_used = max(10, round(char_count * 0.4) + round(len(raw_text) * 0.4))

                            if current_key:
                                key_pool.mark_success(current_key)
                                key_pool.record_key_tokens(current_key, tokens_used)

                            log_manager.emit(
                                level="SUCCESS",
                                event="API_CALL_SUCCESS",
                                message=f"Page {page_number} text correction completed with {model_name} [{key_alias}] in {elapsed}s ({char_count} chars, {tokens_used} tokens).",
                                model=model_name,
                                page_number=page_number,
                                details={"latency_seconds": elapsed, "output_chars": char_count, "tokens_used": tokens_used, "key_alias": key_alias}
                            )

                            return {
                                "success": True,
                                "corrected_text": response.text.strip(),
                                "model_used": model_name,
                                "elapsed_seconds": elapsed,
                                "tokens_used": tokens_used,
                                "error": None
                            }
                    finally:
                        key_pool.release_key(current_key)
                except Exception as e:
                    last_error = str(e)
                    is_invalid_key = (
                        ("401" in last_error or "UNAUTHENTICATED" in last_error or "ACCOUNT_STATE_INVALID" in last_error or "deleted or disabled" in last_error.lower())
                        or ("403" in last_error and "suspended" in last_error.lower())
                        or ("api_key_invalid" in last_error.lower() or "api key not valid" in last_error.lower())
                    )

                    if is_invalid_key and current_key:
                        key_pool.mark_invalid(current_key)
                        tried_keys.append(current_key)
                        log_manager.emit(
                            level="WARN",
                            event="KEY_SUSPENDED_EVICTED",
                            message=f"⛔ [Invalid Key] {key_alias} was rejected by Google (unauthenticated/deleted). Skipping this key and using next key for Page {page_number}...",
                            model=model_name,
                            page_number=page_number,
                            details={"key_alias": key_alias, "action": "instant_failover_evict"}
                        )
                        continue

                    is_rate_limit = ("429" in last_error or "RESOURCE_EXHAUSTED" in last_error or "quota" in last_error.lower() or "permission_denied" in last_error.lower())
                    
                    if is_rate_limit:
                        match = re.search(r"retry in (\d+\.?\d*)s", last_error, re.IGNORECASE)
                        wait_time = float(match.group(1)) + 1.0 if match else 30.0
                        err_lower = last_error.lower()
                        is_daily = ("limit: 20" in err_lower or "generaterequestsperday" in err_lower) and "generaterequestsperminute" not in err_lower and "perminute" not in err_lower

                        if current_key:
                            key_pool.mark_rate_limited(current_key, cooldown_seconds=wait_time, is_daily=is_daily)
                            tried_keys.append(current_key)

                        has_other_keys = (pool_size > 1 and len(set(tried_keys)) < pool_size)
                        if has_other_keys:
                            if is_daily:
                                rate_msg = f"⚡ [Daily Cap (20/day) Reached] {key_alias} on '{model_name}'. Rotating to next replacement key for Page {page_number}..."
                            else:
                                rate_msg = f"🔄 [Key Pacing Cooldown ({int(wait_time)}s)] {key_alias} on '{model_name}'. Instant Failover to next key in pool for Page {page_number}..."

                            log_manager.emit(
                                level="RATE_LIMIT",
                                event="RATE_LIMIT_HIT",
                                message=rate_msg,
                                model=model_name,
                                page_number=page_number,
                                details={"attempt": attempt, "key_alias": key_alias, "action": "instant_failover"}
                            )
                            time.sleep(1.2)  # Safe spacing before leasing next key in pool
                            continue
                        else:
                            sleep_duration = min(wait_time, 20.0)
                            log_manager.emit(
                                level="RATE_LIMIT",
                                event="RATE_LIMIT_HIT",
                                message=f"⏳ [Key Pool Busy] All {pool_size} key(s) are cooling down for '{model_name}'. Pausing {sleep_duration:.0f}s before retry for Page {page_number}...",
                                model=model_name,
                                page_number=page_number,
                                details={"attempt": attempt, "wait_seconds": sleep_duration, "keys_tried": tried_aliases}
                            )
                            time.sleep(sleep_duration)
                            tried_keys.clear()
                    else:
                        is_503 = ("503" in last_error or "UNAVAILABLE" in last_error or "high demand" in last_error.lower())
                        log_manager.emit(
                            level="WARN",
                            event="RETRY_ATTEMPT",
                            message=f"Page {page_number} attempt {attempt} on {model_name} [{key_alias}] failed: {last_error[:120]}...",
                            model=model_name,
                            page_number=page_number,
                            details={"attempt": attempt, "error": last_error, "key_alias": key_alias}
                        )
                        if is_503:
                            cls.mark_model_cooldown(model_name, duration=90.0)
                            fallback_name = models[1] if len(models) > 1 else "fallback model"
                            log_manager.emit(
                                level="WARN",
                                event="MODEL_OVERLOAD_SWITCH",
                                message=f"🔄 [Google Server Overload (503)] '{model_name}' is busy. Automatically switching Page {page_number} to fallback model '{fallback_name}'...",
                                model=model_name,
                                page_number=page_number
                            )
                            time.sleep(1.5)
                            break
                        if attempt < 4:
                            time.sleep(1.0 * attempt)

            log_manager.emit(
                level="WARN",
                event="FALLBACK_MODEL_TRIGGERED",
                message=f"All attempts on '{model_name}' exhausted for Page {page_number}. Triggering fallback model...",
                model=model_name,
                page_number=page_number
            )

        elapsed = round(time.time() - start_time, 2)
        clean_err = format_clean_error(last_error, last_alias, models[-1])
        log_manager.emit(
            level="ERROR",
            event="API_CALL_FAILED",
            message=f"Text correction on Page {page_number} failed across keys [{', '.join(set(tried_aliases))}]. Reason: {clean_err}",
            model=preferred_model or settings.MODELS_TO_TRY[0],
            page_number=page_number,
            details={"error": last_error, "keys_tried": tried_aliases}
        )

        return {
            "success": False,
            "corrected_text": raw_text,
            "model_used": "fallback-raw",
            "elapsed_seconds": elapsed,
            "error": clean_err
        }

    @classmethod
    def process_page_vision_ollama(
        cls,
        image_bytes: bytes,
        page_number: int,
        ollama_url: str = settings.DEFAULT_OLLAMA_URL,
        model: str = "qwen2.5vl:7b"
    ) -> Dict[str, Any]:
        """Processes rendered page image using Ollama Vision API."""
        start_time = time.time()
        img_b64 = base64.b64encode(image_bytes).decode("utf-8")
        endpoint = f"{ollama_url.rstrip('/')}/api/chat"
        
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": KHMER_VISION_PROMPT,
                    "images": [img_b64]
                }
            ],
            "stream": False,
            "options": {"temperature": 0.1}
        }

        log_manager.emit(
            level="INFO",
            event="API_CALL_START",
            message=f"Sending Page {page_number} image to Ollama Vision ({model} at {ollama_url})...",
            model=model,
            page_number=page_number
        )

        last_error = None
        for attempt in range(1, 4):
            try:
                with cls._ollama_lock:
                    res = requests.post(endpoint, json=payload, timeout=600)
                if res.status_code == 200:
                    content = res.json().get("message", {}).get("content", "").strip()
                    elapsed = round(time.time() - start_time, 2)
                    
                    log_manager.emit(
                        level="SUCCESS",
                        event="API_CALL_SUCCESS",
                        message=f"Page {page_number} processed by Ollama Vision ({model}) in {elapsed}s.",
                        model=model,
                        page_number=page_number
                    )

                    return {
                        "success": True,
                        "corrected_text": content,
                        "model_used": model,
                        "elapsed_seconds": elapsed,
                        "error": None
                    }
                else:
                    if res.status_code == 400 and ("multimodal" in res.text.lower() or "not support" in res.text.lower()):
                        last_error = f"Ollama model '{model}' is a text-only LLM and does not support image OCR. Please switch to a vision model (e.g. 'qwen2.5vl:7b' or 'llama3.2-vision') or change Processing Engine to 'Text Extraction (Fast)'."
                        log_manager.emit(
                            level="ERROR",
                            event="OLLAMA_ERROR",
                            message=f"⚠️ {last_error}",
                            model=model,
                            page_number=page_number
                        )
                        break
                    else:
                        last_error = f"Ollama HTTP {res.status_code}: {res.text}"
                        log_manager.emit(
                            level="WARN",
                            event="OLLAMA_ERROR",
                            message=f"Ollama Page {page_number} HTTP {res.status_code}: {res.text[:120]}",
                            model=model,
                            page_number=page_number
                        )
            except Exception as e:
                last_error = str(e)
                log_manager.emit(
                    level="WARN",
                    event="OLLAMA_ERROR",
                    message=f"Ollama Page {page_number} connection error: {last_error[:120]}",
                    model=model,
                    page_number=page_number
                )
                if attempt < 3:
                    time.sleep(1.5 * attempt)

        elapsed = round(time.time() - start_time, 2)
        log_manager.emit(
            level="ERROR",
            event="API_CALL_FAILED",
            message=f"Ollama Vision processing failed on Page {page_number}: {last_error}",
            model=model,
            page_number=page_number
        )

        return {
            "success": False,
            "corrected_text": "",
            "model_used": model,
            "elapsed_seconds": elapsed,
            "error": last_error
        }

    @classmethod
    def process_page_text_ollama(
        cls,
        raw_text: str,
        page_number: int,
        ollama_url: str = settings.DEFAULT_OLLAMA_URL,
        model: str = "qwen2.5vl:7b"
    ) -> Dict[str, Any]:
        """Corrects raw digital Khmer text with Ollama LLM / VLM."""
        if not raw_text.strip():
            return {
                "success": True,
                "corrected_text": "",
                "model_used": "none",
                "elapsed_seconds": 0.0,
                "error": None
            }

        start_time = time.time()
        prompt = KHMER_TEXT_PROMPT_TEMPLATE.format(page_number=page_number, page_text=raw_text)
        
        # Use chat endpoint for seamless compatibility with both VLM and LLM models
        endpoint = f"{ollama_url.rstrip('/')}/api/chat"
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"temperature": 0.1, "num_ctx": 4096}
        }

        log_manager.emit(
            level="INFO",
            event="API_CALL_START",
            message=f"Sending Page {page_number} text to Ollama ({model})...",
            model=model,
            page_number=page_number
        )

        last_error = None
        for attempt in range(1, 4):
            try:
                with cls._ollama_lock:
                    res = requests.post(endpoint, json=payload, timeout=300)
                if res.status_code == 200:
                    elapsed = round(time.time() - start_time, 2)
                    content = res.json().get("message", {}).get("content", "").strip()

                    log_manager.emit(
                        level="SUCCESS",
                        event="API_CALL_SUCCESS",
                        message=f"Page {page_number} text corrected by Ollama ({model}) in {elapsed}s.",
                        model=model,
                        page_number=page_number
                    )

                    return {
                        "success": True,
                        "corrected_text": content,
                        "model_used": model,
                        "elapsed_seconds": elapsed,
                        "error": None
                    }
                else:
                    last_error = f"Ollama HTTP {res.status_code}: {res.text}"
            except Exception as e:
                last_error = str(e)
                if attempt < 3:
                    time.sleep(1.5 * attempt)

        elapsed = round(time.time() - start_time, 2)
        log_manager.emit(
            level="ERROR",
            event="API_CALL_FAILED",
            message=f"Ollama text correction failed on Page {page_number}: {last_error}",
            model=model,
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
    async def process_page_vision_async(
        cls,
        image_bytes: bytes,
        page_number: int,
        provider: str = "gemini",
        api_key: Optional[str] = None,
        preferred_model: Optional[str] = None,
        ollama_url: str = settings.DEFAULT_OLLAMA_URL
    ) -> Dict[str, Any]:
        if provider == "huggingface" or (preferred_model and (preferred_model.startswith("Qwen/") or preferred_model.startswith("meta-llama/"))):
            hf_key = api_key if (api_key and "hf_" in api_key) else settings.HUGGINGFACE_API_KEY
            return await HuggingFaceService.process_page_vision_hf_async(
                image_bytes=image_bytes,
                page_number=page_number,
                api_key=hf_key,
                model=preferred_model or "Qwen/Qwen2.5-VL-72B-Instruct"
            )

        is_ollama = (
            provider == "ollama" or 
            (preferred_model and (
                "qwen2.5vl" in preferred_model.lower() or 
                "qwen2.5-vl" in preferred_model.lower() or 
                "llama3.2-vision" in preferred_model.lower() or
                ":7b" in preferred_model or 
                ":14b" in preferred_model or 
                ":32b" in preferred_model
            ))
        )
        if is_ollama:
            return await asyncio.to_thread(
                cls.process_page_vision_ollama,
                image_bytes=image_bytes,
                page_number=page_number,
                ollama_url=ollama_url,
                model=preferred_model or "qwen2.5vl:7b"
            )
        return await asyncio.to_thread(
            cls.process_page_vision_gemini,
            image_bytes=image_bytes,
            page_number=page_number,
            api_key=api_key,
            preferred_model=preferred_model
        )

    @classmethod
    async def process_page_text_async(
        cls,
        raw_text: str,
        page_number: int,
        provider: str = "gemini",
        api_key: Optional[str] = None,
        preferred_model: Optional[str] = None,
        ollama_url: str = settings.DEFAULT_OLLAMA_URL
    ) -> Dict[str, Any]:
        if provider == "huggingface" or (preferred_model and (preferred_model.startswith("Qwen/") or preferred_model.startswith("meta-llama/"))):
            hf_key = api_key if (api_key and "hf_" in api_key) else settings.HUGGINGFACE_API_KEY
            return await HuggingFaceService.process_page_text_hf_async(
                raw_text=raw_text,
                page_number=page_number,
                api_key=hf_key,
                model=preferred_model
            )

        is_ollama = (
            provider == "ollama" or 
            (preferred_model and (
                "qwen2.5vl" in preferred_model.lower() or 
                "qwen2.5-vl" in preferred_model.lower() or 
                "qwen2.5" in preferred_model.lower() or
                "llama" in preferred_model.lower() or
                ":7b" in preferred_model or 
                ":14b" in preferred_model or 
                ":32b" in preferred_model
            ))
        )
        if is_ollama:
            return await asyncio.to_thread(
                cls.process_page_text_ollama,
                raw_text=raw_text,
                page_number=page_number,
                ollama_url=ollama_url,
                model=preferred_model or "qwen2.5vl:7b"
            )
        return await asyncio.to_thread(
            cls.process_page_text_gemini,
            raw_text=raw_text,
            page_number=page_number,
            api_key=api_key,
            preferred_model=preferred_model
        )

