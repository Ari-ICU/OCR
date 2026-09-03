import time
import threading
from typing import List, Dict, Any, Set, Optional, Tuple

class APIKeyPool:
    """
    Thread-safe Gemini API Key Pool with strict per-key mutual exclusion (Zero concurrency per key),
    in-flight leasing, request pacing, health tracking, token counting, and instant auto-failover.
    """
    def __init__(self, default_keys: Optional[List[str]] = None):
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._default_keys: List[str] = [k.strip() for k in (default_keys or []) if k and k.strip()]
        self._active_leases: Set[str] = set()  # Keys currently executing an in-flight API request
        self._last_request_time: Dict[str, float] = {}  # key -> timestamp of last request start
        self._key_cooldowns: Dict[str, float] = {}  # key -> cooldown_expiry_timestamp
        self._key_daily_exhausted: Dict[str, float] = {}  # key -> daily_expiry_timestamp
        self._key_permanently_invalid: Set[str] = set()
        self._key_usage_count: Dict[str, int] = {}
        self._key_token_count: Dict[str, int] = {}
        self._round_robin_idx: int = 0
        self._min_key_spacing_seconds: float = 1.2  # Smooth request pacing to prevent burst 429s

    def mark_invalid(self, key: str):
        """Permanently evicts a suspended or invalid key from the active pool."""
        with self._lock:
            self._key_permanently_invalid.add(key)
            self._active_leases.discard(key)
            self._cond.notify_all()

    def reset_invalid(self):
        """Clears permanently invalid set to allow fresh key verification."""
        with self._lock:
            self._key_permanently_invalid.clear()
            self._key_cooldowns.clear()
            self._key_daily_exhausted.clear()
            self._cond.notify_all()

    def reset_cooldowns(self):
        """Clears all cooldowns and daily exhausted states for all keys."""
        with self._lock:
            self._key_cooldowns.clear()
            self._key_daily_exhausted.clear()
            self._cond.notify_all()

    @staticmethod
    def parse_keys(raw_input: Optional[str | List[str]]) -> List[str]:
        """Parses comma-separated, newline-separated, or list of keys."""
        if not raw_input:
            return []
        if isinstance(raw_input, list):
            keys = []
            for item in raw_input:
                keys.extend(APIKeyPool.parse_keys(item))
            return keys

        # Handle strings separated by commas, newlines, semicolons, or spaces
        parts = raw_input.replace("\r\n", "\n").replace("\r", "\n").replace(";", ",").split("\n")
        cleaned = []
        for part in parts:
            for subpart in part.split(","):
                k = subpart.strip()
                if k and len(k) > 5 and k not in cleaned:
                    cleaned.append(k)
        return cleaned

    def get_candidate_keys(self, user_keys_raw: Optional[str | List[str]] = None) -> List[str]:
        """Returns the list of usable keys, combining user-provided keys with valid default keys."""
        from app.core.config import settings
        user_keys = self.parse_keys(user_keys_raw)
        default_keys = self.parse_keys([settings.DEFAULT_API_KEY] + self._default_keys)
        
        combined = []
        for k in user_keys + default_keys:
            if k and k not in combined and k not in self._key_permanently_invalid:
                combined.append(k)
        return combined

    def get_next_key(
        self,
        user_keys_raw: Optional[str | List[str]] = None,
        exclude_keys: Optional[List[str]] = None,
        timeout: float = 25.0
    ) -> Tuple[Optional[str], str, int]:
        """
        Exclusively leases the next healthy, non-busy API key.
        Guarantees that NO single API key is ever executed concurrently by multiple worker threads.
        Returns (key_string, key_alias, total_pool_size).
        """
        keys = self.get_candidate_keys(user_keys_raw)
        if not keys:
            return None, "Default-System-Key", 0

        exclude_set = set(exclude_keys or [])
        deadline = time.time() + timeout

        with self._lock:
            while True:
                now = time.time()
                # 1. First priority: healthy keys that are NOT currently in-flight by another thread
                idle_healthy_keys = [
                    k for k in keys 
                    if k not in exclude_set 
                    and k not in self._active_leases
                    and self._key_cooldowns.get(k, 0) <= now 
                    and self._key_daily_exhausted.get(k, 0) <= now
                ]

                if idle_healthy_keys:
                    # Pick using round-robin among idle healthy keys
                    selected_key = idle_healthy_keys[self._round_robin_idx % len(idle_healthy_keys)]
                    self._round_robin_idx = (self._round_robin_idx + 1) % max(1, len(keys))
                    self._active_leases.add(selected_key)
                    self._key_usage_count[selected_key] = self._key_usage_count.get(selected_key, 0) + 1
                    break

                # 2. If keys are healthy but currently in-flight, wait for a lease to be released
                in_flight_healthy = [
                    k for k in keys
                    if k not in exclude_set
                    and k in self._active_leases
                    and self._key_cooldowns.get(k, 0) <= now
                    and self._key_daily_exhausted.get(k, 0) <= now
                ]

                time_left = deadline - time.time()
                if in_flight_healthy and time_left > 0.5:
                    self._cond.wait(timeout=min(2.0, time_left))
                    continue

                # 3. If all candidate keys are on cooldown, pick the one expiring soonest (not daily exhausted and not in-flight)
                available = [
                    k for k in keys 
                    if k not in exclude_set 
                    and self._key_daily_exhausted.get(k, 0) <= now
                ]
                if not available:
                    available = [k for k in keys if k not in exclude_set] or keys

                # Sort by cooldown expiry, prioritizing non-busy keys
                sorted_keys = sorted(available, key=lambda k: (1 if k in self._active_leases else 0, self._key_cooldowns.get(k, 0)))
                selected_key = sorted_keys[0]
                self._active_leases.add(selected_key)
                self._key_usage_count[selected_key] = self._key_usage_count.get(selected_key, 0) + 1
                break

            # Pacing check: enforce minimum spacing between consecutive requests on this same key
            last_time = self._last_request_time.get(selected_key, 0)
            elapsed_since_last = time.time() - last_time
            sleep_needed = self._min_key_spacing_seconds - elapsed_since_last
            self._last_request_time[selected_key] = time.time() + max(0.0, sleep_needed)

        if sleep_needed > 0:
            time.sleep(sleep_needed)

        key_index = keys.index(selected_key) + 1 if selected_key in keys else 1
        key_alias = f"Key #{key_index} (...{selected_key[-4:] if len(selected_key) >= 4 else 'Key'})"
        return selected_key, key_alias, len(keys)

    def release_key(self, key: Optional[str]):
        """
        Releases an active lease on an API key so other worker threads can use it safely.
        Must be called in a finally block after an API operation completes.
        """
        if not key:
            return
        with self._lock:
            self._active_leases.discard(key)
            self._cond.notify_all()

    def record_key_tokens(self, key: str, tokens: int):
        """Records exact tokens consumed by this key."""
        with self._lock:
            self._key_token_count[key] = self._key_token_count.get(key, 0) + max(0, tokens)

    def mark_rate_limited(self, key: str, cooldown_seconds: float = 45.0, is_daily: bool = False):
        """Marks a key as rate-limited (429) for a cooldown duration or 24h daily cap and releases in-flight lock."""
        with self._lock:
            now = time.time()
            if is_daily:
                self._key_daily_exhausted[key] = now + 86400.0  # 24 hours
            else:
                self._key_cooldowns[key] = max(self._key_cooldowns.get(key, 0), now + cooldown_seconds)
            self._active_leases.discard(key)
            self._cond.notify_all()

    def mark_success(self, key: str):
        """Clears cooldown if key succeeded."""
        with self._lock:
            now = time.time()
            if key in self._key_cooldowns and self._key_cooldowns[key] <= now:
                del self._key_cooldowns[key]

    def get_status_detailed(self, user_keys_raw: Optional[str | List[str]] = None) -> List[Dict[str, Any]]:
        """Returns detailed real-time health, in-flight status, cooldown countdown, and tokens for each key."""
        keys = self.get_candidate_keys(user_keys_raw)
        now = time.time()
        with self._lock:
            statuses = []
            for i, k in enumerate(keys):
                if k in self._key_daily_exhausted and self._key_daily_exhausted[k] > now:
                    status = "daily_exhausted"
                    remaining = int(self._key_daily_exhausted[k] - now)
                elif k in self._key_cooldowns and self._key_cooldowns[k] > now:
                    status = "cooldown"
                    remaining = int(self._key_cooldowns[k] - now)
                elif k in self._active_leases:
                    status = "in_flight"
                    remaining = 0
                else:
                    status = "ready"
                    remaining = 0

                usage = self._key_usage_count.get(k, 0)
                statuses.append({
                    "id": i + 1,
                    "alias": f"Key {i + 1}",
                    "suffix": k[-4:] if len(k) >= 4 else "key",
                    "status": status,
                    "cooldown_remaining_seconds": remaining,
                    "usage_count": usage,
                    "daily_limit": 20,
                    "daily_remaining": max(0, 20 - usage),
                    "tokens_used": self._key_token_count.get(k, 0)
                })
            return statuses

key_pool = APIKeyPool()

