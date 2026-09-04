# Khmer PDF & Vision AI Engine (OCR)

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%28Python%29-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016%20%28Turbopack%29-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini%203.6%20%26%203.5%20Flash-4285F4.svg?logo=google&logoColor=white)](https://ai.google.dev/)
[![KaTeX](https://img.shields.io/badge/Math-KaTeX%20LaTeX-3298DC.svg?logo=latex&logoColor=white)](https://katex.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An enterprise-grade, high-performance system for extracting, digitizing, and restoring **Khmer PDF documents**, scanned books, research theses, and technical papers into clean standard **Khmer Unicode Markdown** with **100% LaTeX mathematical & scientific formulas**.

---

## 📑 Table of Contents
- [🌟 Key Features](#-key-features)
- [🔄 How It Works](#-how-it-works)
- [🚀 Quick Start Guide](#-quick-start-guide)
  - [1. Backend Setup](#1-backend-setup)
  - [2. Frontend Setup](#2-frontend-setup)
  - [3. Getting Free Gemini API Keys](#3-getting-free-gemini-api-keys)
- [🌐 Production Server Deployment (PM2 + Nginx)](#-production-server-deployment-pm2--nginx)
- [🖥️ Using the Web Application](#️-using-the-web-application)
  - [Tab 1: PDF Extraction (`#pdf`)](#tab-1-pdf-extraction-pdf)
  - [Tab 2: Live Activity Monitor (`#monitor`)](#tab-2-live-activity-monitor-monitor)
  - [Tab 3: Key Pool & Usage Telemetry (`#keys`)](#tab-3-key-pool--usage-telemetry-keys)
- [🔑 Multi-Key Scaling & Rate Limit Management](#-multi-key-scaling--rate-limit-management)
- [💻 Standalone CLI Batch OCR](#-standalone-cli-batch-ocr)
- [🏗️ System Architecture](#️-system-architecture)
- [📡 REST API Reference](#-rest-api-reference)
- [❓ Frequently Asked Questions (FAQ)](#-frequently-asked-questions-faq)
- [📄 License](#-license)

---

## 🌟 Key Features

- 🇰🇭 **High-Accuracy Multimodal Khmer OCR**: Powered by Google Gemini 3.7 Flash, Gemini 3.6 Flash, and Gemini 3.5 Flash. Accurately preserves consonant sub-clusters (ជើង), complex vowels, diacritics, and legacy font encodings.
- 📐 **100% LaTeX Mathematical & Scientific Restoration**: Automatically detects, formats, and renders complex formulas ($...$, $$...$$, fractions, square roots, matrices, chemistry equations) into KaTeX LaTeX.
- 🔑 **Multi-Account API Key Pool & Load Balancer**: Supports adding multiple Gemini API keys. The engine automatically rotates keys using round-robin scheduling, mutual exclusion pacing, and instant 429 quota failover.
- ⚡ **Zero-Downtime 3-Tier Cascade**: When a key hits the 20 requests/day cap on `gemini-3.7-flash`, the system automatically rotates keys or cascades down through `gemini-3.6-flash` and `gemini-3.5-flash` with zero downtime.
- 📊 **Real-Time Key Usage Dashboard**: Live telemetry tracking requests processed, tokens consumed, active cooldown countdowns, and remaining daily quota for every key.
- 🔄 **Real-Time SSE Streaming**: Live parallel page processing with visual worker chips (`P1`, `P2`), thumbnail previews, and instant page-by-page rendering.
- 🛡️ **Live API Key Verification & Auto-Purge**: Built-in verification tool that tests all keys against Google's API simultaneously and allows 1-click purging of invalid or deleted keys.
- 📥 **Multi-Format Export**: 1-click download as Markdown (`.md`), Plain Text (`.txt`), or structured JSON (`.json`).

---

## 🔄 How It Works

```mermaid
graph LR
    A[📄 Upload PDF / Image] --> B[🖼️ PyMuPDF Render 300 DPI]
    B --> C[🔑 Multi-Key Pool Manager]
    C --> D[🤖 Gemini 3.6 Flash / 3.5 Flash]
    D --> E[📐 LaTeX & Khmer Unicode Engine]
    E --> F[📡 Real-Time SSE Stream to UI]
    F --> G[📥 Export .md / .txt / .json]
```

1. **Upload**: Drop any PDF file or image into the web interface.
2. **Page Rendering**: PyMuPDF renders pages at crisp 300 DPI high resolution.
3. **Key Leasing**: The `APIKeyPool` safely leases an available, non-busy key with mutual exclusion.
4. **Vision AI OCR**: Gemini analyzes the visual page, restoring Khmer text and formatting math formulas into LaTeX.
5. **Live Streaming**: Results stream page-by-page directly to the browser with instant KaTeX math rendering.

---

## 🚀 Quick Start Guide

### 1. Backend Setup

Open a terminal window:

```bash
# 1. Navigate to the backend directory
cd backend

# 2. Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install required Python packages
pip install -r requirements.txt

# 4. Start the FastAPI backend server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

- **Health Endpoint**: `http://127.0.0.1:8000/api/health`
- **Swagger Documentation**: `http://127.0.0.1:8000/docs`

---

### 2. Frontend Setup

Open a second terminal window:

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install Node.js dependencies
npm install

# 3. Start the Next.js development server
npm run dev
```

- Open your browser and navigate to **`http://localhost:3000`**.

---

### 3. Getting Free Gemini API Keys

1. Visit **[Google AI Studio (aistudio.google.com/app/apikey)](https://aistudio.google.com/app/apikey)**.
2. Sign in with your Google account.
3. Click **"Create API Key"** and copy the key.
4. Open the web app, go to the **API Keys Tab (`#keys`)**, paste your key(s), and click **"Save & Activate Pool"**.

*(Tip: You can paste multiple keys from different Google accounts to increase your daily extraction speed!)*

---

## 🌐 Production Server Deployment (PM2 + Nginx)

For full step-by-step instructions on deploying to a remote Linux server (such as a school/university server, dedicated machine, or VPS) using SSH, see our dedicated **[Production Server Deployment Guide](PRODUCTION_DEPLOYMENT.md)**.

### Quick Deployment on Ubuntu / Debian Server:

```bash
# 1. Connect to your server
ssh username@server_ip

# 2. Install prerequisites
sudo apt update && sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx git
sudo npm install -g pm2

# 3. Clone and deploy
git clone <your-repo-url> ~/khmer-ocr
cd ~/khmer-ocr
cp .env.example backend/.env  # edit backend/.env to set GEMINI_API_KEY
chmod +x deploy.sh
./deploy.sh

# 4. Enable Nginx reverse proxy
sudo cp nginx.conf /etc/nginx/sites-available/khmer-ocr
sudo ln -s /etc/nginx/sites-available/khmer-ocr /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Open **`http://YOUR_SERVER_IP`** in any web browser!

---

## 🖥️ Using the Web Application

### Tab 1: PDF Extraction (`#pdf`)
- **Upload Box**: Drag and drop any PDF document or image file.
- **Page Range Selector**: Extract the entire document or select a specific range (e.g. `1-20`).
- **Parallel Workers Slider**: Adjust concurrency (1 to 6 parallel workers) based on your key pool size.
- **Continuous Mode**: Append new page extractions to an existing document without restarting.
- **Live Output**: View formatted Khmer Markdown and rendered KaTeX mathematical equations in real-time.
- **Export Bar**: Download results as `.md`, `.txt`, `.json`, or copy all text to clipboard with 1 click.

### Tab 2: Live Activity Monitor (`#monitor`)
- **Real-Time Terminal**: Streams live backend events, processing latencies, worker leases, and auto-failovers.
- **Status Badges**: Filter logs by `INFO`, `SUCCESS`, `WARN`, or `RATE_LIMIT`.

### Tab 3: Key Pool & Usage Telemetry (`#keys`)
- **Global Metrics**:
  - **Requests Processed**: Total calls made across all keys today.
  - **AI Tokens Used**: Total multimodal OCR tokens consumed.
  - **Ready Keys**: Healthy, available keys ready to process pages.
  - **Remaining Quota**: Estimated daily capacity left (e.g. `~600 page/day`).
- **Live Per-Key Grid**: Shows exact requests executed, token usage, and live status for each key (`🟢 Ready`, `🔵 In-Flight`, `🟡 Cooldown`, `🔴 Daily Cap`).
- **Verify All Live**: Tests all keys against Google's API simultaneously.
- **Purge Invalid Keys**: Automatically removes broken or deleted keys with 1 click.
- **Reset Cooldowns**: Instantly unlocks cooling keys.

---

## 🔑 Multi-Key Scaling & Rate Limit Management

Google Gemini provides a free tier of **20 requests/day per key per model** and **15 RPM (Requests Per Minute)**.

By leveraging our **3-Tier Cascade (`gemini-3.7-flash` -> `gemini-3.6-flash` -> `gemini-3.5-flash`)**, each key provides **60 requests / day**:

| Keys in Pool | 1 Model (20 RPD) | 3-Tier Multi-Model Pool (60 RPD) | Peak Throughput | Recommended Parallel Workers |
| :---: | :---: | :---: | :---: | :---: |
| **1 Key** | ~20 pages/day | **~60 pages/day** | 15 RPM | 1-2 workers |
| **10 Keys** | ~200 pages/day | **~600 pages/day** | 150 RPM | 2-3 workers |
| **30 Keys** | ~600 pages/day | **~1,800 pages/day** | 450 RPM | 3-4 workers |
| **56 Keys** | ~1,120 pages/day | **🔥 ~3,360 pages/day** | 840 RPM | 3-5 workers |

### Automatic 2-Stage Failover Logic:
1. **Key Rotation (Quality First):** The engine processes pages with **Gemini 3.7 Flash**, rotating sequentially across keys #1 to #56.
2. **Model Cascade (Zero Downtime):** When keys exhaust their 20/20 limit on 3.7, the engine automatically rolls over to **Gemini 3.6 Flash** (+1,120 pages), and then **Gemini 3.5 Flash** (+1,120 pages).
3. **Paced Health Management:** Temporary 429 rate limits place a key on a short cooldown (e.g. 30s) while immediately routing subsequent pages to ready keys without blocking.

---

## 💻 Standalone CLI Batch OCR

You can also run batch OCR directly from the terminal without using the web interface:

```bash
# Extract full PDF using Gemini Vision OCR
python3 pdf_to_khmer_text.py sample.pdf --mode vision --output output.txt

# Extract specific page range (e.g. Pages 1 to 20)
python3 pdf_to_khmer_text.py sample.pdf --start-page 1 --end-page 20 -o pages_1_20.txt

# Append to existing output file
python3 pdf_to_khmer_text.py sample.pdf --start-page 21 --end-page 40 -o pages_1_20.txt --append

# Use a specific Gemini API key
python3 pdf_to_khmer_text.py sample.pdf --api-key "AIzaSy..." --mode vision -o output.txt
```

---

## 🏗️ System Architecture

```text
pdf-text/
├── backend/                      # FastAPI Python Backend
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/           # API route handlers
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
├── .gitignore                    # Git ignore rules
└── README.md                     # Project documentation
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health status and supported models list |
| `POST` | `/api/extract-preview` | Extracts page count, metadata, and visual thumbnails |
| `POST` | `/api/extract-correct-stream` | Server-Sent Events (SSE) live extraction & OCR stream |
| `POST` | `/api/reprocess-page` | Re-runs OCR restoration on a single specific page |
| `POST` | `/api/key-pool-status` | Real-time key usage, tokens, and cooldown status |
| `POST` | `/api/keys/verify` | Validates multiple API keys against Google's API |
| `POST` | `/api/keys/reset-cooldowns`| Clears all cooldowns and unlocks all keys |
| `POST` | `/api/keys/reset-invalid`  | Clears invalid key cache for fresh re-testing |
| `GET` | `/api/logs` | Fetches historical backend telemetry logs |
| `GET` | `/api/logs/stream` | Server-Sent Events (SSE) real-time log event stream |

---

## ❓ Frequently Asked Questions (FAQ)

#### Q: What happens when I see `Daily Cap` on my keys?
**A:** Google gives 20 free requests per day on `gemini-3.6-flash`. When this cap is reached, our system automatically continues processing your pages using **`gemini-3.5-flash`** (or you can wait for Google's daily quota reset at 7:00 AM ICT).

#### Q: How many API keys should I add?
**A:** Adding **10 to 30 keys** allows you to process entire books or multi-chapter research theses in parallel at high speed.

#### Q: Are my API keys stored on a server?
**A:** No. Your API keys are stored securely in your browser's `localStorage` and sent directly to your local FastAPI backend server.

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
