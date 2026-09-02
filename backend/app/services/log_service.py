import time
import json
import asyncio
import threading
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from collections import deque

class LogEntry:
    def __init__(
        self,
        level: str,
        event: str,
        message: str,
        model: Optional[str] = None,
        page_number: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        self.id = f"{int(time.time() * 1000)}-{id(message) % 10000}"
        self.timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        self.iso_time = datetime.now().isoformat()
        self.level = level.upper()  # INFO, SUCCESS, WARN, ERROR, RATE_LIMIT
        self.event = event          # e.g. RATE_LIMIT_HIT, RETRY_BACKOFF, API_SUCCESS, MODEL_FALLBACK
        self.message = message
        self.model = model
        self.page_number = page_number
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "iso_time": self.iso_time,
            "level": self.level,
            "event": self.event,
            "message": self.message,
            "model": self.model,
            "page_number": self.page_number,
            "details": self.details
        }

class LogManager:
    """Thread-safe in-memory ring buffer with pub-sub broadcasting for real-time SSE log monitoring."""
    def __init__(self, max_history: int = 500):
        self._lock = threading.Lock()
        self._history: deque[Dict[str, Any]] = deque(maxlen=max_history)
        self._subscribers: List[Tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = []
        self._stats = {
            "total_calls": 0,
            "successful_calls": 0,
            "failed_calls": 0,
            "rate_limit_hits": 0,
            "last_rate_limit_time": None,
            "active_retries": 0
        }

    def emit(
        self,
        level: str,
        event: str,
        message: str,
        model: Optional[str] = None,
        page_number: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Creates and stores a log entry, updating stats and notifying live subscribers thread-safely."""
        entry = LogEntry(
            level=level,
            event=event,
            message=message,
            model=model,
            page_number=page_number,
            details=details
        )
        data = entry.to_dict()

        with self._lock:
            self._history.append(data)

            # Update stats
            if event == "API_CALL_START":
                self._stats["total_calls"] += 1
            elif event == "API_CALL_SUCCESS":
                self._stats["successful_calls"] += 1
            elif event == "API_CALL_FAILED":
                self._stats["failed_calls"] += 1
            elif event == "RATE_LIMIT_HIT":
                self._stats["rate_limit_hits"] += 1
                self._stats["last_rate_limit_time"] = data["timestamp"]

            # Push to active SSE subscriber queues thread-safely
            dead_subs = []
            for loop, q in list(self._subscribers):
                try:
                    if loop.is_closed():
                        dead_subs.append((loop, q))
                    else:
                        def make_safe_put(target_q, item):
                            def _fn():
                                try:
                                    if target_q.full():
                                        try:
                                            target_q.get_nowait()
                                        except Exception:
                                            pass
                                    target_q.put_nowait(item)
                                except Exception:
                                    pass
                            return _fn
                        loop.call_soon_threadsafe(make_safe_put(q, data))
                except Exception:
                    dead_subs.append((loop, q))

            for item in dead_subs:
                if item in self._subscribers:
                    self._subscribers.remove(item)

        # Print to terminal console for local debugging
        color_map = {
            "INFO": "\033[94m",      # Blue
            "SUCCESS": "\033[92m",   # Green
            "WARN": "\033[93m",      # Yellow
            "ERROR": "\033[91m",     # Red
            "RATE_LIMIT": "\033[95m" # Magenta
        }
        reset = "\033[0m"
        color = color_map.get(entry.level, "")
        page_str = f" (Page {page_number})" if page_number else ""
        model_str = f" [{model}]" if model else ""
        print(f"{color}[{entry.timestamp}] [{entry.level}]{model_str}{page_str} {message}{reset}", flush=True)

        return data

    def subscribe(self) -> asyncio.Queue:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        with self._lock:
            self._subscribers.append((loop, q))
        return q

    def unsubscribe(self, q: asyncio.Queue):
        with self._lock:
            self._subscribers = [s for s in self._subscribers if s[1] is not q]

    def get_logs(self, limit: int = 100, level: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._lock:
            logs = list(self._history)
        if level and level.upper() != "ALL":
            logs = [l for l in logs if l["level"] == level.upper()]
        return logs[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                **self._stats,
                "stored_logs_count": len(self._history),
                "subscribers_count": len(self._subscribers)
            }

    def clear(self):
        with self._lock:
            self._history.clear()
            self._stats = {
                "total_calls": 0,
                "successful_calls": 0,
                "failed_calls": 0,
                "rate_limit_hits": 0,
                "last_rate_limit_time": None,
                "active_retries": 0
            }

log_manager = LogManager(max_history=500)
