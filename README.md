# KhmerPDF AI — Khmer PDF Vision OCR & LaTeX Math Engine

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%28Python%29-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016%20%28React%29-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini%203.5%20Flash%20Lite-4285F4.svg?logo=google&logoColor=white)](https://ai.google.dev/)
[![KaTeX](https://img.shields.io/badge/Math-KaTeX%20LaTeX-3298DC.svg?logo=latex&logoColor=white)](https://katex.org/)

An enterprise-grade, high-performance system for extracting, digitizing, and restoring **Khmer PDF documents**, scanned books, research theses, and technical papers into clean standard **Khmer Unicode Markdown** with **100% LaTeX mathematical & scientific formulas**.

---

## 🌟 Key Features

- **Multimodal Vision OCR**: Uses Google Gemini 3.5 Flash Lite / 3.6 Flash / 3.7 Flash and local Ollama VLM models to read high-resolution rendered PDF pages directly.
- **Khmer Unicode Integrity**: Preserves standard Unicode ordering (`Base Consonant + Subscript ជើង + Vowel + Signs`) and fixes legacy font corruptions.
- **Mathematical & STEM Restoration**: Detects, compiles, and formats complex equations ($...$, $$...$$, fractions, matrices, roots, chemistry formulas) into KaTeX LaTeX.
- **Multi-Key Pool & 429 Instant Failover**: Supports multi-account Gemini API keys with round-robin load balancing and instant zero-wait failover on rate limits.
- **Real-Time SSE Streaming**: Live page-by-page rendering, worker slot animation, and batch progress tracking.
- **Khmer Red Line Spellchecker**: Real-time visual anomaly detector highlighting broken subscripts or misplaced vowels with red wavy underlines and tooltips.
- **Continuous Multi-Batch Extraction**: Freely process specific page ranges (e.g. `1-10`, `11-20`) with seamless sequential appending and merging.
- **Live Telemetry Monitor**: Integrated terminal streaming real-time backend API events, latencies, and rate-limit cooldown metrics.
- **Multi-Format Export**: Export results to `.md` (Markdown), `.txt` (Plain Text), or `.json` with 1-click clipboard copying.

---

## 🏗️ System Architecture

```
pdf-text/
├── backend/                  # FastAPI Python Backend
│   ├── app/
│   │   ├── api/routes/       # API endpoints (pdf, logs, health)
│   │   ├── core/config.py    # System settings & model metadata
│   │   ├── services/
│   │   │   ├── ai_service.py     # Gemini & Ollama Multimodal Vision / LLM logic
│   │   │   ├── key_manager.py    # Multi-key pool rotation & rate-limit cooldown
│   │   │   ├── log_service.py    # Ring buffer & SSE log broadcasting
│   │   │   └── pdf_service.py    # PyMuPDF rendering & text extraction
│   │   └── main.py           # FastAPI entry point & CORS configuration
│   └── requirements.txt
│
├── frontend/                 # Next.js 16 (App Router) + Tailwind CSS
│   ├── src/
│   │   ├── app/              # Main page, layout, globals.css
│   │   ├── components/       # UI Components (Navbar, FileUpload, PageCard,
│   │   │                     # ProcessingBackbone, LogMonitor, StatsBar, MathRenderer)
│   │   └── utils/            # khmerValidator (Red wavy line detector)
│   └── package.json
│
├── pdf_to_khmer_text.py      # Standalone CLI batch extraction script
└── sample_khmer.pdf          # Sample Khmer PDF document for testing
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites

Ensure you have installed:
- **Python 3.10+**
- **Node.js 18+** and **npm**
- *(Optional)* **Ollama** if you plan to run local offline models (`ollama run qwen2.5:7b`)

---

### 2. Backend Setup & Run

1. Open a terminal in the project root:
```bash
# Create and activate Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r backend/requirements.txt
```

2. Start the FastAPI backend server:
```bash
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
- API Health Endpoint: `http://127.0.0.1:8000/api/health`
- Swagger Documentation: `http://127.0.0.1:8000/docs`

---

### 3. Frontend Setup & Run

1. Open a second terminal window:
```bash
cd frontend

# Install Node dependencies
npm install

# Start development server
npm run dev
```
2. Open your browser and navigate to **`http://localhost:3000`**.

---

### 4. Standalone CLI Tool Usage

You can also run batch conversions directly from the terminal without opening the web interface:

```bash
# Extract using Gemini Vision OCR (Recommended)
./.venv/bin/python pdf_to_khmer_text.py sample_khmer.pdf --mode vision --output full_thesis.txt

# Extract specific page range (e.g. Pages 1 to 10)
./.venv/bin/python pdf_to_khmer_text.py sample_khmer.pdf --start-page 1 --end-page 10 -o pages_1_10.txt

# Append to an existing output file
./.venv/bin/python pdf_to_khmer_text.py sample_khmer.pdf --start-page 11 --end-page 20 -o pages_1_10.txt --append

# Use local Ollama offline Vision OCR model
./.venv/bin/python pdf_to_khmer_text.py sample_khmer.pdf --provider ollama --mode vision --model qwen2.5vl:7b -o output.txt
```

---

## ⚙️ Configuration & API Keys

### Adding Gemini API Keys
1. **Via UI**: Click **Settings** (`⚙️`) in the top navbar. Paste 1, 2, or more Gemini API keys (one per line). Keys are securely remembered in browser `localStorage`.
2. **Via Environment Variable**:
```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
```

### Supported Models
| Model ID | Provider | Type | Recommended For |
| :--- | :--- | :--- | :--- |
| `gemini-3.6-flash` | Google AI | Multimodal VLM | **High-Accuracy Khmer Vision OCR, Subscripts & LaTeX Formulas (#1 Recommended)** |
| `gemini-3.5-flash` | Google AI | Multimodal VLM | **High-Throughput Khmer OCR & LaTeX restoration (#2 Recommended)** |
| `qwen2.5vl:7b` | Ollama (Local) | Multimodal VLM | **Fast 7B Local Vision OCR directly on your Mac with zero rate limits** |
| `qwen2.5vl:32b` | Ollama (Local) | Multimodal VLM | **High-Precision 32B Local Vision OCR directly on your Mac (Heavy/Detailed)** |
| `Qwen/Qwen2.5-VL-72B-Instruct` | Hugging Face | Multimodal VLM | Free cloud Vision OCR backup |
| `llama3.2-vision:11b` | Ollama (Local) | Multimodal VLM | Offline local Vision OCR |

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health status and active models list |
| `POST` | `/api/extract-preview` | Extracts page count, metadata, and visual thumbnails |
| `POST` | `/api/extract-correct-stream` | Server-Sent Events (SSE) live extraction & OCR stream |
| `POST` | `/api/reprocess-page` | Re-runs AI restoration on a single specific page |
| `GET` | `/api/logs` | Fetches historical backend telemetry logs |
| `GET` | `/api/logs/stream` | Server-Sent Events (SSE) real-time log event stream |

---

## 📄 License

This project is licensed under the MIT License.
