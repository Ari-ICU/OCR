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
from app.services.pdf_service import PDFService


KHMER_VISION_PROMPT = r"""You are an expert Khmer OCR, document digitizer, and computational linguist.
Analyze this high-resolution page image carefully and extract all contents into clean, perfectly structured Markdown:

CRITICAL INSTRUCTIONS:
1. Khmer Language Priority & Focus:
   - This tool is specifically tailored for Khmer document digitization.
   - If this page is ENTIRELY in English or a foreign language with ZERO Khmer text (e.g. pure English abstract, English bibliography/references, English copyright page), output EXACTLY:
     [ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]
     Do not transcribe English-only pages.
   - If the page contains Khmer text (or mixed Khmer with English terms, math, STEM formulas, and tables), faithfully extract all Khmer content and STEM formulas with 100% precision.

2. Strict Document Fidelity (Zero Hallucination):
   - Extract ONLY text that is actually present in this page image.
   - NEVER invent, assume, or add institution names, university headers, student names, author lines, or advisor titles if they do not exist on this specific page.

3. Spatial Layout & Reading Order (Top to Bottom):
   - HEADER: If the page has a top header, chapter title, or running header, place it at the very top. (If no header exists, do not add one).
   - MAIN BODY: Section headings, body paragraphs, bullet points, data tables, charts, and footnotes belong in the middle body in exact logical reading order.
   - FOOTER: If the page has running footers, author signatures, or page numbers at the bottom, place them at the very BOTTOM (last line) of the output. (If no footer exists, do not add one).

4. Khmer Orthography, Unicode & Precision:
   - Accurately read all Khmer words with 100% faithful spelling.
   - Fix broken Unicode sequences into standard Khmer Unicode order (Consonant + Subscript ជើង + Dependent Vowel + Diacritics).
   - Restore subscript consonants (ជើង U+17D2, e.g. ្ត, ្ម, ្រ, ្ល, ្ង, ្ធ, ្ញ).
   - Ensure proper vowel positioning (e.g. preposition "នៃ", not misplaced "ៃន").
   - Fix common OCR misrecognitions (e.g. "ជាពិសេស", "ថាមាន", "ជាប់", "ភាពរឹងមាំ").
   - Prevent phantom character insertions inside compound words.

5. Mathematical & STEM Formatting:
   - Convert all mathematical formulas, equations, percentages ($...$), scientific notations, fractions (\frac{a}{b}), roots, matrices, and variables into clean LaTeX ($...$ for inline or $$...$$ for block).

6. Tables & Formatting:
   - Output tables in clean Markdown format with aligned columns.
   - Preserve bullet points, numbering hierarchy, and bold formatting.

7. Output Format:
   - Output ONLY the clean Markdown content of this page.
   - Do NOT include conversational commentary, notes, or introductions.
"""

KHMER_TEXT_PROMPT_TEMPLATE = """You are an expert Khmer linguist, academic editor, and STEM proofreader.
Below is raw digital text extracted from Page {page_number} of a PDF document.

CRITICAL INSTRUCTIONS:
1. Khmer Language Priority:
   - If this text is entirely in English/foreign language without any Khmer characters, output EXACTLY:
     [ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]
   - Otherwise, restore and fix the Khmer text and LaTeX formulas.

2. Strict Fidelity (Zero Hallucination):
   - Fix and restore ONLY the content provided below.
   - NEVER invent or inject headers, university names, author lines, or titles that are not present in this raw text.

3. Spatial Layout & Structure:
   - If the text contains top header lines, place them at the top.
   - If the text contains footer lines or page numbers, place them at the very bottom.
   - Keep all headings, paragraphs, bullet lists, and tables in original logical reading order.

4. Khmer Unicode, Orthography & Spelling:
   - Fix all scrambled or broken Khmer Unicode sequences (Consonant + ជើង + Vowel + Signs).
   - Fix broken vowels, misplaced vowels (e.g. "នៃ", not "ៃន"), and common OCR/font corruption.
   - Preserve correct spelling of all proper nouns, terms, and names actually in the text.

5. STEM & Tables:
   - Format numbers, formulas, and math into clean LaTeX ($...$ or $$...$$).
   - Format tables cleanly in Markdown syntax.

6. Output Format:
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
        if "generaterequestsperday" in raw_error.lower() or "generate_content_requests_per_day" in raw_error.lower():
            return f"[{key_alias}] ⚠️ Free-tier Daily Project Limit (RPD cap on '{model_name}') reached. Automatically switching to backup key / fallback models..."
        
        match = re.search(r"retry in (\d+\.?\d*)s", raw_error, re.IGNORECASE)
        retry_msg = f" (Retry in {match.group(1)}s)" if match else ""
        return f"[{key_alias}] 429 Rate Limit hit on model '{model_name}'.{retry_msg}"
        
    return f"[{key_alias}] {raw_error[:140]}"


import threading

class AIService:
    _model_cooldowns: Dict[str, float] = {}
    _model_lock = threading.Lock()
    _ollama_lock = threading.Lock()
    _cancelled_sessions: set = set()
    _active_session_id: Optional[str] = None
    _session_lock = threading.Lock()

    @classmethod
    def set_active_session(cls, session_id: str):
        with cls._session_lock:
            cls._active_session_id = session_id

    @classmethod
    def cancel_session(cls, session_id: Optional[str] = None):
        """Immediately marks session(s) as cancelled so active worker threads abort."""
        with cls._session_lock:
            if session_id:
                cls._cancelled_sessions.add(session_id)
            if cls._active_session_id:
                cls._cancelled_sessions.add(cls._active_session_id)
                cls._active_session_id = None

    @classmethod
    def is_cancelled(cls, session_id: Optional[str] = None) -> bool:
        with cls._session_lock:
            if session_id and session_id in cls._cancelled_sessions:
                return True
            if session_id and cls._active_session_id and session_id != cls._active_session_id:
                return True
            if not session_id and cls._active_session_id is None and len(cls._cancelled_sessions) > 0:
                return True
        return False

    @classmethod
    def sleep_interruptible(cls, seconds: float, session_id: Optional[str] = None) -> bool:
        """Sleeps in small chunks (0.2s) while checking is_cancelled. Returns True if cancelled, False if finished."""
        end = time.time() + seconds
        while time.time() < end:
            if cls.is_cancelled(session_id):
                return True
            time.sleep(min(0.2, max(0.01, end - time.time())))
        return cls.is_cancelled(session_id)

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
        preferred_model: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Processes rendered page image using Gemini Multimodal Vision API
        with multi-key pool rotation, live logging & instant 429 auto-failover.
        """
        if cls.is_cancelled(session_id):
            return {
                "success": False,
                "corrected_text": "",
                "model_used": "cancelled",
                "elapsed_seconds": 0.0,
                "error": "Processing cancelled by user"
            }

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
                if cls.is_cancelled(session_id):
                    return {
                        "success": False,
                        "corrected_text": "",
                        "model_used": "cancelled",
                        "elapsed_seconds": 0.0,
                        "error": "Processing cancelled by user"
                    }

                current_key, key_alias, pool_size = key_pool.get_next_key(user_keys_raw=api_key, exclude_keys=tried_keys)
                last_alias = key_alias
                if key_alias not in tried_aliases:
                    tried_aliases.append(key_alias)

                try:
                    if cls.is_cancelled(session_id):
                        return {
                            "success": False,
                            "corrected_text": "",
                            "model_used": "cancelled",
                            "elapsed_seconds": 0.0,
                            "error": "Processing cancelled by user"
                        }

                    try:
                        client = cls.get_gemini_client(current_key)
                        call_start = time.time()
                        response = client.models.generate_content(
                            model=model_name,
                            contents=[
                                types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                                KHMER_VISION_PROMPT
                            ]
                        )
                        if cls.is_cancelled(session_id):
                            return {
                                "success": False,
                                "corrected_text": "",
                                "model_used": "cancelled",
                                "elapsed_seconds": 0.0,
                                "error": "Processing cancelled by user"
                            }
                        if response.text:
                            elapsed = round(time.time() - start_time, 2)
                            raw_resp = response.text.strip()
                            char_count = len(raw_resp)
                            
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

                            is_blank = PDFService.is_contentless_or_blank_text(raw_resp)
                            is_pure_english = (
                                not is_blank and (
                                    "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង" in raw_resp
                                    or "English Page - Skipped" in raw_resp
                                    or PDFService.is_english_dominant_content(raw_resp)
                                )
                            )

                            if is_blank:
                                final_text = ""
                                used_model = "blank-skipped"
                                log_manager.emit(
                                    level="INFO",
                                    event="PAGE_SKIPPED",
                                    message=f"⏩ Page {page_number} is blank or contains only an isolated page number. Marked as skipped.",
                                    model="blank-skipped",
                                    page_number=page_number,
                                    details={"latency_seconds": elapsed, "key_alias": key_alias}
                                )
                            elif is_pure_english:
                                final_text = "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]"
                                used_model = "english-skipped"
                                log_manager.emit(
                                    level="INFO",
                                    event="PAGE_SKIPPED",
                                    message=f"⏩ Page {page_number} is entirely in English with no meaningful Khmer. Marked as skipped.",
                                    model="english-skipped",
                                    page_number=page_number,
                                    details={"latency_seconds": elapsed, "key_alias": key_alias}
                                )
                            else:
                                final_text = raw_resp
                                used_model = model_name
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
                                "corrected_text": final_text,
                                "model_used": used_model,
                                "elapsed_seconds": elapsed,
                                "tokens_used": tokens_used,
                                "error": None,
                                "is_blank": is_blank,
                                "is_english_skipped": is_pure_english
                            }
                    finally:
                        key_pool.release_key(current_key)
                except Exception as e:
                    if cls.is_cancelled(session_id):
                        return {
                            "success": False,
                            "corrected_text": "",
                            "model_used": "cancelled",
                            "elapsed_seconds": 0.0,
                            "error": "Processing cancelled by user"
                        }
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
                        is_daily = ("generaterequestsperday" in err_lower or "generate_content_requests_per_day" in err_lower or "limit: 20" in err_lower or "limit: 1500" in err_lower) and "generaterequestsperminute" not in err_lower and "perminute" not in err_lower

                        if current_key:
                            key_pool.mark_rate_limited(current_key, cooldown_seconds=wait_time, is_daily=is_daily)
                            tried_keys.append(current_key)

                        has_other_keys = (pool_size > 1 and len(set(tried_keys)) < pool_size)
                        if has_other_keys:
                            if is_daily:
                                rate_msg = f"⚡ [Daily Cap Reached] {key_alias} on '{model_name}'. Rotating to next replacement key for Page {page_number}..."
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
                            if cls.sleep_interruptible(1.0, session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "error": "Processing cancelled by user"}
                            continue
                        else:
                            cooldown_left = key_pool.get_min_cooldown_remaining(api_key)
                            sleep_duration = max(3.0, min(cooldown_left if cooldown_left > 0 else wait_time, 45.0))
                            log_manager.emit(
                                level="RATE_LIMIT",
                                event="RATE_LIMIT_HIT",
                                message=f"⏳ [Key Pool Cooling Down] All {pool_size} key(s) cooling for '{model_name}'. Waiting {sleep_duration:.0f}s for key reset before resuming Page {page_number}...",
                                model=model_name,
                                page_number=page_number,
                                details={"attempt": attempt, "wait_seconds": sleep_duration, "keys_tried": tried_aliases}
                            )
                            wait_start = time.time()
                            while time.time() - wait_start < sleep_duration:
                                if cls.is_cancelled(session_id):
                                    return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "error": "Processing cancelled by user"}
                                if key_pool.wait_for_any_key_ready(api_key, timeout=min(1.0, sleep_duration)):
                                    break
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
                            if cls.is_cancelled(session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "error": "Processing cancelled by user"}
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
                            if cls.sleep_interruptible(1.5, session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "error": "Processing cancelled by user"}
                            break
                        if attempt < 4:
                            if cls.sleep_interruptible(1.0 * attempt, session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "error": "Processing cancelled by user"}

            if cls.is_cancelled(session_id):
                return {
                    "success": False,
                    "corrected_text": "",
                    "model_used": "cancelled",
                    "elapsed_seconds": 0.0,
                    "error": "Processing cancelled by user"
                }

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
        preferred_model: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Corrects raw digital Khmer text using Gemini API
        with multi-key pool rotation, live logging & instant 429 auto-failover.
        """
        if cls.is_cancelled(session_id):
            return {
                "success": False,
                "corrected_text": "",
                "model_used": "cancelled",
                "elapsed_seconds": 0.0,
                "tokens_used": 0,
                "error": "Processing cancelled by user"
            }

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
                if cls.is_cancelled(session_id):
                    return {
                        "success": False,
                        "corrected_text": "",
                        "model_used": "cancelled",
                        "elapsed_seconds": 0.0,
                        "tokens_used": 0,
                        "error": "Processing cancelled by user"
                    }

                current_key, key_alias, pool_size = key_pool.get_next_key(user_keys_raw=api_key, exclude_keys=tried_keys)
                last_alias = key_alias
                if key_alias not in tried_aliases:
                    tried_aliases.append(key_alias)

                try:
                    try:
                        client = cls.get_gemini_client(current_key)
                        call_start = time.time()
                        response = client.models.generate_content(
                            model=model_name,
                            contents=prompt
                        )
                        if cls.is_cancelled(session_id):
                            return {
                                "success": False,
                                "corrected_text": "",
                                "model_used": "cancelled",
                                "elapsed_seconds": 0.0,
                                "error": "Processing cancelled by user"
                            }
                        if response.text:
                            elapsed = round(time.time() - start_time, 2)
                            raw_resp = response.text.strip()
                            char_count = len(raw_resp)
                            
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

                            is_blank = PDFService.is_contentless_or_blank_text(raw_resp)
                            is_pure_english = (
                                not is_blank and (
                                    "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង" in raw_resp
                                    or "English Page - Skipped" in raw_resp
                                    or PDFService.is_english_dominant_content(raw_resp)
                                )
                            )

                            if is_blank:
                                final_text = ""
                                used_model = "blank-skipped"
                                log_manager.emit(
                                    level="INFO",
                                    event="PAGE_SKIPPED",
                                    message=f"⏩ Page {page_number} is blank or contains only an isolated page number. Marked as skipped.",
                                    model="blank-skipped",
                                    page_number=page_number,
                                    details={"latency_seconds": elapsed, "key_alias": key_alias}
                                )
                            elif is_pure_english:
                                final_text = "[ទំព័រជាភាសាអង់គ្លេសសុទ្ធ - រំលង (Pure English Page - Skipped)]"
                                used_model = "english-skipped"
                                log_manager.emit(
                                    level="INFO",
                                    event="PAGE_SKIPPED",
                                    message=f"⏩ Page {page_number} is entirely in English with no meaningful Khmer. Marked as skipped.",
                                    model="english-skipped",
                                    page_number=page_number,
                                    details={"latency_seconds": elapsed, "key_alias": key_alias}
                                )
                            else:
                                final_text = raw_resp
                                used_model = model_name
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
                                "corrected_text": final_text,
                                "model_used": used_model,
                                "elapsed_seconds": elapsed,
                                "tokens_used": tokens_used,
                                "error": None,
                                "is_blank": is_blank,
                                "is_english_skipped": is_pure_english
                            }
                    finally:
                        key_pool.release_key(current_key)
                except Exception as e:
                    if cls.is_cancelled(session_id):
                        return {
                            "success": False,
                            "corrected_text": "",
                            "model_used": "cancelled",
                            "elapsed_seconds": 0.0,
                            "error": "Processing cancelled by user"
                        }
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
                        is_daily = ("generaterequestsperday" in err_lower or "generate_content_requests_per_day" in err_lower or "limit: 20" in err_lower or "limit: 1500" in err_lower) and "generaterequestsperminute" not in err_lower and "perminute" not in err_lower

                        if current_key:
                            key_pool.mark_rate_limited(current_key, cooldown_seconds=wait_time, is_daily=is_daily)
                            tried_keys.append(current_key)

                        has_other_keys = (pool_size > 1 and len(set(tried_keys)) < pool_size)
                        if has_other_keys:
                            if is_daily:
                                rate_msg = f"⚡ [Daily Cap Reached] {key_alias} on '{model_name}'. Rotating to next replacement key for Page {page_number}..."
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
                            if cls.sleep_interruptible(1.0, session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "error": "Processing cancelled by user"}
                            continue
                        else:
                            cooldown_left = key_pool.get_min_cooldown_remaining(api_key)
                            sleep_duration = max(3.0, min(cooldown_left if cooldown_left > 0 else wait_time, 45.0))
                            log_manager.emit(
                                level="RATE_LIMIT",
                                event="RATE_LIMIT_HIT",
                                message=f"⏳ [Key Pool Cooling Down] All {pool_size} key(s) cooling for '{model_name}'. Waiting {sleep_duration:.0f}s for key reset before resuming Page {page_number}...",
                                model=model_name,
                                page_number=page_number,
                                details={"attempt": attempt, "wait_seconds": sleep_duration, "keys_tried": tried_aliases}
                            )
                            wait_start = time.time()
                            while time.time() - wait_start < sleep_duration:
                                if cls.is_cancelled(session_id):
                                    return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "tokens_used": 0, "error": "Processing cancelled by user"}
                                if key_pool.wait_for_any_key_ready(api_key, timeout=min(1.0, sleep_duration)):
                                    break
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
                            if cls.is_cancelled(session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "tokens_used": 0, "error": "Processing cancelled by user"}
                            cls.mark_model_cooldown(model_name, duration=90.0)
                            fallback_name = models[1] if len(models) > 1 else "fallback model"
                            log_manager.emit(
                                level="WARN",
                                event="MODEL_OVERLOAD_SWITCH",
                                message=f"🔄 [Google Server Overload (503)] '{model_name}' is busy. Automatically switching Page {page_number} to fallback model '{fallback_name}'...",
                                model=model_name,
                                page_number=page_number
                            )
                            if cls.sleep_interruptible(1.5, session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "tokens_used": 0, "error": "Processing cancelled by user"}
                            break
                        if attempt < 4:
                            if cls.sleep_interruptible(1.0 * attempt, session_id):
                                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "tokens_used": 0, "error": "Processing cancelled by user"}

            if cls.is_cancelled(session_id):
                return {"success": False, "corrected_text": "", "model_used": "cancelled", "elapsed_seconds": 0.0, "tokens_used": 0, "error": "Processing cancelled by user"}

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
        ollama_url: str = settings.DEFAULT_OLLAMA_URL,
        session_id: Optional[str] = None
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
            preferred_model=preferred_model,
            session_id=session_id
        )

    @classmethod
    async def process_page_text_async(
        cls,
        raw_text: str,
        page_number: int,
        provider: str = "gemini",
        api_key: Optional[str] = None,
        preferred_model: Optional[str] = None,
        ollama_url: str = settings.DEFAULT_OLLAMA_URL,
        session_id: Optional[str] = None
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
            preferred_model=preferred_model,
            session_id=session_id
        )

