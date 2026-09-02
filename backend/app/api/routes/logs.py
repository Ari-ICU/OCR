import json
import asyncio
from typing import Optional
from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from app.services.log_service import log_manager

router = APIRouter(prefix="/logs", tags=["Logs & Rate Limit Monitor"])

@router.get("")
def get_logs(
    limit: int = Query(100, ge=1, le=500),
    level: Optional[str] = Query("ALL")
):
    """Returns recent structured log entries and aggregate metrics."""
    return {
        "stats": log_manager.get_stats(),
        "logs": log_manager.get_logs(limit=limit, level=level)
    }

@router.get("/stats")
def get_log_stats():
    """Returns real-time API call metrics and rate limit counters."""
    return log_manager.get_stats()

@router.delete("")
def clear_logs():
    """Clears all stored logs and resets metrics."""
    log_manager.clear()
    return {"message": "Logs cleared successfully", "stats": log_manager.get_stats()}

@router.get("/stream")
async def stream_logs(request: Request):
    """
    Streams live API execution logs, rate limit warnings, and AI calls
    in real-time via Server-Sent Events (SSE). Exits cleanly on disconnect or server reload.
    """
    queue = log_manager.subscribe()

    async def event_generator():
        try:
            # First send initial stats and recent backlog
            recent = log_manager.get_logs(limit=30)
            yield f"event: init\ndata: {json.dumps({'stats': log_manager.get_stats(), 'backlog': recent})}\n\n"

            while True:
                if await request.is_disconnected():
                    break

                try:
                    # Check for new logs with a short 3s heartbeat so reloads happen instantaneously
                    entry = await asyncio.wait_for(queue.get(), timeout=3.0)
                    yield f"event: log\ndata: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        break
                    yield f"event: ping\ndata: {json.dumps({'stats': log_manager.get_stats()})}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            log_manager.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
        }
    )
