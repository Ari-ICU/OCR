# Khmer PDF & Vision AI Engine - Backend Architecture

A modular, high-performance, and scalable FastAPI backend for converting Khmer PDFs into clean standard Khmer Unicode text and LaTeX formulas using Multimodal Vision AI & LLMs.

---

## Scalable Directory Structure

```
backend/
├── app/
│   ├── main.py               # FastAPI application factory (CORS, lifespan, router registration)
│   ├── core/
│   │   ├── config.py         # Centralized configuration (Settings, models, environment variables)
│   │   └── __init__.py
│   ├── models/
│   │   ├── schemas.py        # Pydantic Request & Response validation models
│   │   └── __init__.py
│   ├── services/             # Business & Domain Logic Layer
│   │   ├── ai_service.py     # Multimodal Vision OCR & LLM correction (Gemini + Ollama)
│   │   ├── pdf_service.py    # PyMuPDF rendering, thumbnail generation, & page slicing
│   │   ├── export_service.py # Output formatting (.txt, .md, .json)
│   │   └── __init__.py
│   └── api/                  # Controller & HTTP Layer
│       ├── router.py         # Main /api Router aggregator
│       ├── __init__.py
│       └── routes/
│           ├── health.py     # GET /api/health, GET /api/models
│           ├── pdf.py        # POST /api/extract-preview, POST /api/extract-correct-stream
│           ├── correction.py # POST /api/correct-text, POST /api/reprocess-page
│           ├── export.py     # POST /api/export
│           └── __init__.py
├── main.py                   # Main entry point with backwards compatibility
├── requirements.txt          # Python dependencies
└── README.md                 # Architecture documentation
```

---

## Architectural Principles

1. **Separation of Concerns**:
   - **`app.core`**: Holds environment configs and model metadata in a single source of truth.
   - **`app.models`**: Strictly defines request validation, response models, and data transfer objects (DTOs).
   - **`app.services`**: Encapsulates external AI APIs, PyMuPDF rendering, and text transformation logic, completely decoupled from HTTP handling.
   - **`app.api`**: Modular sub-routers focused purely on endpoint validation and streaming responses.
2. **Factory Pattern**:
   - `create_app()` in `app.main` enables easy unit testing, staging environments, and integration into ASGI servers (e.g. Uvicorn / Gunicorn).
3. **High-Concurrency Asynchronous Streaming**:
   - Uses native FastAPI `StreamingResponse` with `asyncio.Semaphore` worker pools for non-blocking Server-Sent Events (SSE).
4. **Resilience & Fault Tolerance**:
   - Exponential backoff retry mechanisms for Google Gemini and self-hosted Ollama providers.

---

## Running the Server

### Development
```bash
cd backend
uvicorn main:app --port 8000 --reload
```

### Production with Multiple Workers
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```
