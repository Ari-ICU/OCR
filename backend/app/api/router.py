from fastapi import APIRouter
from app.api.routes import health, pdf, correction, export, logs, keys

api_router = APIRouter(prefix="/api")

# Register sub-routers
api_router.include_router(health.router)
api_router.include_router(pdf.router)
api_router.include_router(correction.router)
api_router.include_router(export.router)
api_router.include_router(logs.router)
api_router.include_router(keys.router)

