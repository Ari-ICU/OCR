import os
import time
import sys
import re
import json
import base64
from typing import Optional, List
import requests

# pyrefly: ignore [missing-import]
try:
    # pyrefly: ignore [missing-import]
    import pymupdf as fitz
except ImportError:
    # pyrefly: ignore [missing-import]
    import fitz

from google import genai
from google.genai import types

# Default API Key (can also be read from environment variable)
DEFAULT_API_KEY = os.environ.get("GEMINI_API_KEY", "")

DEFAULT_OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

KHMER_VISION_PROMPT = r"""You are an expert Khmer OCR, document digitizer, and computational linguist.
Analyze this high-resolution page image carefully and extract all contents into clean Markdown:

CRITICAL INSTRUCTIONS:
1. Strict Document Fidelity (Zero Hallucination):
   - Extract ONLY text that is actually present in this page image.
   - NEVER invent, assume, or add institution names, university headers, student names, author lines, or advisor titles if they do not exist on this specific page.

2. Spatial Layout & Reading Order (Top to Bottom):
   - HEADER: If the page has a top header, chapter title, or running header, place it at the very top. (If no header exists, do not add one).
   - MAIN BODY: All paragraphs, section numbers, bullet lists, and tables belong in the middle body in exact reading order.
   - FOOTER: If the page has running footers, author signatures, or page numbers, place them at the very BOTTOM of the output. (If no footer exists, do not add one).

3. Khmer Accuracy, Unicode & Spelling:
   - Extract ALL Khmer text accurately with 100% faithful spelling.
   - Fix broken Unicode sequences into standard Khmer Unicode order (Consonant + Subscript ជើង + Vowel + Signs).
   - Restore subscript consonants (ជើង U+17D2, e.g. ្ត, ្ម, ្រ, ្ល) and all diacritics/vowels.
   - Ensure proper vowel positioning (e.g. preposition "នៃ", not misplaced "ៃន").
   - Fix common OCR misrecognitions (e.g. "ជាពិសេស", "ថាមាន", "ជាប់", "ភាពរឹងមាំ").

4. Mathematical & Scientific Formulas:
   - Accurately convert all mathematical equations, arithmetic, chemical formulas, and scientific notations into LaTeX ($...$ for inline or $$...$$ for block).
   - Ensure fractions (\frac{a}{b}), roots (\sqrt{x}), superscripts/subscripts, matrices, and Greek symbols are preserved.

5. Tables & Formatting:
   - Convert tables into standard Markdown table format.
   - Preserve headers, bullet lists, numbering, and paragraph structure.

6. Output Format:
   - Output ONLY the clean Markdown content of this page.
   - Do NOT include conversational commentary, notes, or introductions.
"""

KHMER_TEXT_PROMPT_TEMPLATE = """You are an expert Khmer linguist, academic editor, and STEM proofreader.
Below is raw text extracted from Page {page_number} of a PDF document.

CRITICAL INSTRUCTIONS:
1. Strict Fidelity (Zero Hallucination):
   - Fix and restore ONLY the text provided below.
   - NEVER inject headers, university names, author lines, or titles that do not exist in this raw text.

2. Spatial Layout & Structure:
   - If the text has header lines, place them at the top.
   - If the text has footer lines or page numbers, place them at the very bottom.
   - Preserve original paragraph structure, headings, and lists.

3. Khmer Unicode, Orthography & Spelling:
   - Fix all broken Khmer Unicode sequences (base consonant + ជើង + dependent vowel + signs in standard Unicode order).
   - Preposition: "នៃ" (not "ៃន").
   - Fix "ជាពិសេស", "ថាមាន", "ជាប់", "ភាពរឹងមាំ".
   - Strictly preserve correct spelling of all actual names and terms in the text.

4. Formulas & Technical Notation:
   - Accurately preserve and format all mathematical equations, arithmetic, percentages, and scientific notations into LaTeX ($...$ or $$...$$).

5. Output Format:
   - Output ONLY the corrected Khmer Markdown text.
   - Do NOT include conversational filler, introductory remarks, explanations, or metadata.

Raw Text from Page {page_number}:
--------------------------------
{page_text}
--------------------------------
"""

def get_gemini_client(api_key: str = DEFAULT_API_KEY) -> genai.Client:
    """Initializes and returns the Google GenAI client."""
    os.environ["GEMINI_API_KEY"] = api_key
    return genai.Client(api_key=api_key)

def render_page_to_image_bytes(page, dpi: int = 300) -> bytes:
    """Renders a PDF page to high-res PNG image bytes using PyMuPDF (no poppler needed)."""
    pix = page.get_pixmap(dpi=dpi)
    return pix.tobytes("png")

def process_page_vision_ollama(
    image_bytes: bytes,
    page_number: int,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    model: str = "qwen2.5vl:7b"
) -> str:
    """
    Sends rendered page image to Ollama Vision Model (e.g. qwen2.5vl:7b / llama3.2-vision).
    Bypasses corrupted digital PDF fonts by doing pure Vision OCR.
    """
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
        "options": {
            "temperature": 0.1
        }
    }
    
    for attempt in range(1, 4):
        try:
            response = requests.post(endpoint, json=payload, timeout=300)
            if response.status_code == 200:
                data = response.json()
                content = data.get("message", {}).get("content", "").strip()
                if content:
                    return content
            else:
                print(f"  [!] (Page {page_number}) Ollama Vision error HTTP {response.status_code}: {response.text}")
        except Exception as e:
            print(f"  [!] (Page {page_number}) Ollama Vision attempt {attempt} failed: {e}")
            if attempt < 3:
                time.sleep(2 * attempt)
                
    print(f"  [X] Failed to process page {page_number} via Ollama Vision.")
    return ""

def process_page_vision_gemini(
    client: genai.Client,
    image_bytes: bytes,
    page_number: int,
    models: list = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]
) -> str:
    """Sends rendered page image to Gemini Vision API."""
    for model_name in models:
        for attempt in range(1, 4):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                        KHMER_VISION_PROMPT
                    ]
                )
                if response.text:
                    return response.text.strip()
            except Exception as e:
                err_str = str(e)
                print(f"  [!] (Page {page_number}) Attempt {attempt} with {model_name} failed: {err_str[:120]}...")
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    match = re.search(r"retry in (\d+\.?\d*)s", err_str, re.IGNORECASE)
                    wait_time = float(match.group(1)) + 1.0 if match else (8 * attempt)
                    print(f"  [⏳] Rate limit reached. Backing off for {wait_time:.1f}s...")
                    time.sleep(wait_time)
                else:
                    if attempt < 3:
                        time.sleep(2 * attempt)
    return ""

def process_page_text_gemini(
    client: genai.Client,
    page_text: str,
    page_number: int,
    models: list = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"]
) -> str:
    """Sends raw page text to Gemini to fix Khmer Unicode order, spelling, and formulas."""
    prompt = KHMER_TEXT_PROMPT_TEMPLATE.format(page_number=page_number, page_text=page_text)
    for model_name in models:
        for attempt in range(1, 4):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt
                )
                if response.text:
                    return response.text.strip()
            except Exception as e:
                err_str = str(e)
                print(f"  [!] (Page {page_number}) Attempt {attempt} with {model_name} failed: {err_str[:120]}...")
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    match = re.search(r"retry in (\d+\.?\d*)s", err_str, re.IGNORECASE)
                    wait_time = float(match.group(1)) + 1.0 if match else (8 * attempt)
                    print(f"  [⏳] Rate limit reached. Backing off for {wait_time:.1f}s...")
                    time.sleep(wait_time)
                else:
                    if attempt < 3:
                        time.sleep(2 * attempt)
    return page_text

def process_page_text_ollama(
    page_text: str,
    page_number: int,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    model: str = "qwen2.5:7b"
) -> str:
    """Sends extracted raw text to Ollama LLM for correction with streaming to prevent timeouts."""
    prompt = KHMER_TEXT_PROMPT_TEMPLATE.format(page_number=page_number, page_text=page_text)
    endpoint = f"{ollama_url.rstrip('/')}/api/generate"
    
    for attempt in range(1, 4):
        try:
            response = requests.post(
                endpoint,
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": True,
                    "options": {
                        "temperature": 0.1,
                        "num_ctx": 4096,
                        "num_predict": 2048
                    }
                },
                timeout=600,
                stream=True
            )
            if response.status_code == 200:
                full_text = ""
                for line in response.iter_lines():
                    if line:
                        chunk = json.loads(line.decode("utf-8"))
                        full_text += chunk.get("response", "")
                        if chunk.get("done", False):
                            break
                if full_text.strip():
                    return full_text.strip()
            else:
                print(f"  [!] (Page {page_number}) Ollama error HTTP {response.status_code}: {response.text}")
        except Exception as e:
            print(f"  [!] (Page {page_number}) Ollama attempt {attempt} failed: {e}")
            if attempt < 3:
                time.sleep(2 * attempt)

    print(f"  [X] Failed to process page {page_number} via Ollama. Falling back to raw text.")
    return page_text

def convert_pdf_to_khmer(
    pdf_path: str, 
    output_path: str,
    mode: str = "vision",
    provider: str = "ollama",
    api_key: str = DEFAULT_API_KEY,
    ollama_url: str = DEFAULT_OLLAMA_URL,
    model: Optional[str] = None,
    dpi: int = 300,
    start_page: int = 1,
    end_page: Optional[int] = None,
    append_mode: bool = False
):
    """
    Converts Khmer PDF to text (.txt) using either Vision OCR or Text AI Correction.
    """
    if not os.path.exists(pdf_path):
        print(f"Error: File '{pdf_path}' does not exist.")
        return

    print(f"=== Opening PDF: {pdf_path} ===")
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    
    start_idx = max(0, start_page - 1)
    end_idx = min(total_pages, end_page) if end_page else total_pages
    
    selected_model = model or ("qwen2.5vl:7b" if (mode == "vision" and provider == "ollama") else ("qwen2.5vl:7b" if provider == "ollama" else "gemini-3.6-flash"))
    
    print(f"Total pages in PDF : {total_pages}")
    print(f"Processing range   : Page {start_idx + 1} to Page {end_idx}")
    print(f"Processing Mode    : {mode.upper()} {'(DPI: ' + str(dpi) + ')' if mode == 'vision' else ''}")
    print(f"AI Provider        : {provider.upper()} ({selected_model})")
    print(f"Output File        : {output_path}\n")

    client = get_gemini_client(api_key) if provider == "gemini" else None
    file_mode = "a" if append_mode else "w"

    with open(output_path, file_mode, encoding="utf-8") as f:
        for page_idx in range(start_idx, end_idx):
            page_num = page_idx + 1
            page = doc[page_idx]

            print(f"--- Processing Page {page_num}/{total_pages} ---")

            if mode == "vision":
                print(f"  Rendering Page {page_num} at {dpi} DPI and running Vision OCR ({selected_model})...")
                img_bytes = render_page_to_image_bytes(page, dpi=dpi)
                
                if provider == "ollama":
                    result_text = process_page_vision_ollama(
                        image_bytes=img_bytes,
                        page_number=page_num,
                        ollama_url=ollama_url,
                        model=selected_model
                    )
                else:
                    result_text = process_page_vision_gemini(
                        client=client,
                        image_bytes=img_bytes,
                        page_number=page_num,
                        models=[selected_model, "gemini-3.5-flash"]
                    )
            else:
                # Text extraction mode
                raw_page_text = page.get_text("text").strip()
                if not raw_page_text:
                    print(f"  Page {page_num} has no selectable text. Skipping.")
                    continue
                print(f"  Extracting & correcting text on Page {page_num} ({len(raw_page_text)} chars)...")
                
                if provider == "ollama":
                    result_text = process_page_text_ollama(
                        page_text=raw_page_text,
                        page_number=page_num,
                        ollama_url=ollama_url,
                        model=selected_model
                    )
                else:
                    models = [selected_model, "gemini-3.5-flash"]
                    result_text = process_page_text_gemini(
                        client=client,
                        page_text=raw_page_text,
                        page_number=page_num,
                        models=models
                    )
            
            # Format output block for text file (.txt)
            is_empty_page = not result_text or len(result_text.strip()) == 0
            page_content = "[ទំព័រទទេ / Blank Page]" if is_empty_page else result_text
            page_block = f"=== Page {page_num} ===\n\n{page_content}\n\n"
            f.write(page_block)
            f.flush()
            
            print(f"  ✓ Page {page_num} completed.")
            time.sleep(0.5 if provider == "ollama" else 1.5)

    print(f"\n==========================================")
    print(f"All done! Output saved to: {output_path}")
    print(f"==========================================")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Khmer PDF Vision OCR & AI Restoration Tool (Ollama & Gemini)")
    parser.add_argument("pdf_file", nargs="?", default="sample_khmer.pdf", help="Path to input PDF file")
    parser.add_argument("output_file", nargs="?", default="output_khmer.txt", help="Path to output text file (.txt)")
    parser.add_argument("--output", "-o", default=None, help="Explicit path to output text file (.txt)")
    parser.add_argument("--mode", "-m", choices=["vision", "text"], default="vision", help="Processing mode: 'vision' (VLM OCR from rendered image, default) or 'text' (digital stream)")
    parser.add_argument("--provider", "-p", choices=["ollama", "gemini"], default="gemini", help="AI provider: 'gemini' (default) or 'ollama' (Self-Hosted/Local/VPS)")
    parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL, help="Ollama server URL (e.g. http://localhost:11434 or http://YOUR_VPS_IP:11434)")
    parser.add_argument("--model", default="gemini-3.6-flash", help="Model name (e.g. 'gemini-3.6-flash', 'gemini-3.5-flash', 'qwen2.5:7b')")
    parser.add_argument("--key", "-k", default=DEFAULT_API_KEY, help="Google Gemini API Key (if using gemini)")
    parser.add_argument("--dpi", type=int, default=300, help="Image render resolution DPI (default: 300 for crisp Khmer subscripts)")
    parser.add_argument("--start-page", "-s", type=int, default=1, help="Start page number (1-indexed)")
    parser.add_argument("--end-page", "-e", type=int, default=None, help="End page number (inclusive)")
    parser.add_argument("--append", "-a", action="store_true", help="Append to existing output file instead of overwriting")

    args = parser.parse_args()
    
    output_target = args.output if args.output else args.output_file

    convert_pdf_to_khmer(
        pdf_path=args.pdf_file,
        output_path=output_target,
        mode=args.mode,
        provider=args.provider,
        api_key=args.key,
        ollama_url=args.ollama_url,
        model=args.model,
        dpi=args.dpi,
        start_page=args.start_page,
        end_page=args.end_page,
        append_mode=args.append
    )

if __name__ == "__main__":
    main()
