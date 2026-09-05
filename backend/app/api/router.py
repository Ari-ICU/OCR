from fastapi import APIRouter
from app.api.routes import health, pdf, correction, export, logs, keys, dataset

api_router = APIRouter(prefix="/api")

# Register sub-routers
api_router.include_router(health.router)
api_router.include_router(pdf.router)
api_router.include_router(pdf.router, prefix="/pdf")
api_router.include_router(dataset.router)
api_router.include_router(dataset.router, prefix="/pdf")
api_router.include_router(correction.router)
api_router.include_router(export.router)
api_router.include_router(logs.router)
api_router.include_router(keys.router)

