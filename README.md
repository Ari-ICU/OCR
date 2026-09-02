# Khmer PDF & Vision AI Engine (OCR)

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%28Python%29-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016%20%28Turbopack%29-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini%203.6%20%26%203.5%20Flash-4285F4.svg?logo=google&logoColor=white)](https://ai.google.dev/)
[![KaTeX](https://img.shields.io/badge/Math-KaTeX%20LaTeX-3298DC.svg?logo=latex&logoColor=white)](https://katex.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An enterprise-grade, high-throughput system for extracting, digitizing, and restoring **Khmer PDF documents**, scanned books, research theses, and technical papers into clean standard **Khmer Unicode Markdown** with **100% LaTeX mathematical & scientific formulas**.

---

## 🌟 Key Features

- 🇰🇭 **Multimodal Khmer Vision OCR**: Powered by Google Gemini 3.6 Flash and Gemini 3.5 Flash to accurately recognize complex Khmer scripts, ligatures, subscripts (ជើង), and diacritics.
- 📐 **100% LaTeX Mathematical & Scientific Restoration**: Automatically detects and restores inline/display mathematical formulas ($...$, $$...$$, fractions, matrices, roots, chemical equations) into rendered KaTeX LaTeX.
- 🔑 **Multi-Account API Key Pool & Load Balancer**: Supports adding multiple Gemini API keys. The engine automatically rotates keys using round-robin scheduling, mutual exclusion pacing, and instant 429 quota failover.
- ⚡ **Zero-Downtime Fallback & Pacing**: When a key reaches the daily free cap (20 requests/day) on `gemini-3.6-flash`, the system seamlessly fails over to `gemini-3.5-flash` or the next replacement key in the pool.
- 📊 **Real-Time Key Telemetry Dashboard**: Live monitoring for requests processed, tokens consumed, active cooldown countdowns, and remaining daily quota per key.
- 🔄 **Real-Time SSE Streaming**: Live parallel page processing with visual worker chips (`P1`, `P2`), thumbnail previews, and instant page-by-page streaming.
- 🛡️ **Live API Key Verification & Auto-Purge**: Built-in verification tool that tests all keys against Google's API simultaneously and allows 1-click purging of invalid or deleted keys.
- 💻 **Live Telemetry Terminal**: Real-time log monitor streaming backend events, latencies, model fallbacks, and rate-limit diagnostics.
- 📥 **Multi-Format Export**: 1-click download as Markdown (`.md`), Plain Text (`.txt`), or structured JSON (`.json`).

---

## 🏗️ System Architecture

```text
pdf-text/
├── backend/                      # FastAPI Python Backend
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/           # API routes
│   │   │   │   ├── pdf.py        # PDF extraction & SSE streaming
│   │   │   │   ├── keys.py       # Key pool status, reset & verification
│   │   │   │   ├── logs.py       # Live telemetry & log streaming
│   │   │   │   ├── health.py     # Health checks & system metadata
│   │   │   │   └── export.py     # Markdown/Text/JSON export endpoints
│   │   │   └── router.py         # Main API router registry
│   │   ├── core/
│   │   │   └── config.py         # App configuration & Gemini model settings
│   │   ├── services/
│   │   │   ├── ai_service.py     # Gemini Vision OCR & prompt engineering
│   │   │   ├── key_manager.py    # Multi-key pool rotation, leasing & cooldowns
│   │   │   ├── pdf_service.py    # PyMuPDF rendering & image extraction
│   │   │   └── log_service.py    # Ring buffer & SSE log broadcasting
│   │   └── main.py               # FastAPI application entry point
│   └── requirements.txt
│
├── frontend/                     # Next.js 16 (Turbopack) Frontend
│   ├── src/
│   │   ├── app/                  # App Router (page.tsx, layout.tsx, globals.css)
│   │   ├── components/           # UI Components
│   │   │   ├── Navbar.tsx            # Header navigation & tab switching
│   │   │   ├── FileUpload.tsx        # Drag & drop PDF/image uploader
│   │   │   ├── ProcessingBackbone.tsx# Live worker slots, progress & key pool pills
│   │   │   ├── KeyManagementView.tsx # Multi-key management & telemetry dashboard
│   │   │   ├── PageCard.tsx          # Page Markdown/KaTeX preview card
│   │   │   ├── MathRenderer.tsx      # KaTeX LaTeX formula renderer
│   │   │   └── LogMonitor.tsx        # Real-time backend terminal log viewer
│   │   └── config/api.ts         # API base URL configuration
│   └── package.json
│
├── pdf_to_khmer_text.py          # Standalone CLI batch extraction script
├── .gitignore                    # Git ignore file
└── README.md
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Python 3.10+**
- **Node.js 18+** & **npm**

---

### 2. Backend Setup

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the FastAPI server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- **Health Check**: `http://127.0.0.1:8000/api/health`
- **Swagger API Docs**: `http://127.0.0.1:8000/docs`

---

### 3. Frontend Setup

```bash
# 1. Open a new terminal and navigate to frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Start the Next.js development server
npm run dev
```

- Open **`http://localhost:3000`** in your browser.

---

### 4. Standalone CLI Batch OCR

You can also run batch OCR directly from the command line:

```bash
# Extract full PDF using Gemini Vision OCR
python3 pdf_to_khmer_text.py sample.pdf --mode vision --output output.txt

# Extract specific page range (e.g. Pages 1 to 20)
python3 pdf_to_khmer_text.py sample.pdf --start-page 1 --end-page 20 -o pages_1_20.txt

# Append to existing output file
python3 pdf_to_khmer_text.py sample.pdf --start-page 21 --end-page 40 -o pages_1_20.txt --append
```

---

## 🔑 Multi-Key Scaling & Rate Limit Management

Google Gemini provides a free tier of **20 requests/day per key** for `gemini-3.6-flash` and **15 RPM (Requests Per Minute)**.

To scale your throughput:
1. Obtain free API keys from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Navigate to the **API Keys Tab (`#keys`)** in the web application.
3. Paste your keys (one per line) into the pool.
4. Click **"Save & Activate Pool"**.

### Capacity Scaling Example:
| Active Keys in Pool | Daily Free Capacity | Throughput (RPM) | Parallel Workers |
| :---: | :---: | :---: | :---: |
| **1 Key** | ~20 pages/day | 15 RPM | 1-2 workers |
| **10 Keys** | ~200 pages/day | 150 RPM | 2-4 workers |
| **30 Keys** | ~600 pages/day | 450 RPM | 4-6 workers |

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health status and supported models |
| `POST` | `/api/extract-preview` | Extracts page count, metadata, and visual thumbnails |
| `POST` | `/api/extract-correct-stream` | Server-Sent Events (SSE) live extraction & OCR stream |
| `POST` | `/api/reprocess-page` | Re-runs OCR restoration on a single specific page |
| `POST` | `/api/key-pool-status` | Real-time key usage, tokens, and cooldown status |
| `POST` | `/api/keys/verify` | Validates multiple API keys against Google's API |
| `POST` | `/api/keys/reset-cooldowns`| Clears all cooldowns and unlocks all keys |
| `GET` | `/api/logs` | Fetches historical backend telemetry logs |
| `GET` | `/api/logs/stream` | Server-Sent Events (SSE) real-time log event stream |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
