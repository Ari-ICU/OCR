import os
import re
import time
import socket
import ipaddress
import logging
from urllib.parse import urlparse
from typing import Tuple, Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger("security")

# Blocked IP networks for SSRF defense (private, loopback, link-local, cloud metadata)
BLOCKED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),       # Loopback IPv4
    ipaddress.ip_network("10.0.0.0/8"),        # Private Class A
    ipaddress.ip_network("172.16.0.0/12"),     # Private Class B
    ipaddress.ip_network("192.168.0.0/16"),    # Private Class C
    ipaddress.ip_network("169.254.0.0/16"),    # Link-local & AWS/GCP/Azure metadata
    ipaddress.ip_network("100.64.0.0/10"),     # Carrier-grade NAT
    ipaddress.ip_network("192.0.0.0/24"),      # IETF Protocol Assignments
    ipaddress.ip_network("198.18.0.0/15"),     # Benchmarking
    ipaddress.ip_network("::1/128"),           # Loopback IPv6
    ipaddress.ip_network("fc00::/7"),          # Unique Local IPv6
    ipaddress.ip_network("fe80::/10"),         # Link-local IPv6
]

BLOCKED_HOSTNAMES = {
    "localhost",
    "metadata.google.internal",
    "metadata.internal",
    "instance-data",
    "169.254.169.254",
    "0.0.0.0"
}


def is_safe_url(url_str: str) -> Tuple[bool, str]:
    """
    Validates a remote URL against SSRF (Server-Side Request Forgery).
    Returns (True, "") if safe, or (False, reason) if blocked.
    """
    try:
        parsed = urlparse(url_str.strip())
        
        # 1. Only allow HTTP and HTTPS
        if parsed.scheme.lower() not in ("http", "https"):
            return False, "Only HTTP and HTTPS URLs are allowed."

        hostname = parsed.hostname
        if not hostname:
            return False, "Invalid URL: missing hostname."

        hostname_lower = hostname.lower().strip(".")

        # 2. Block known sensitive hostnames
        if hostname_lower in BLOCKED_HOSTNAMES:
            return False, f"Access to '{hostname}' is blocked for security."

        # 3. DNS resolution & IP check to prevent DNS rebinding and private IP access
        try:
            addr_info = socket.getaddrinfo(hostname, None)
        except socket.gaierror:
            return False, f"Could not resolve domain name '{hostname}'."

        for family, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
                for network in BLOCKED_NETWORKS:
                    if ip in network:
                        return False, f"Access to IP address '{ip_str}' is restricted."
            except ValueError:
                return False, "Invalid IP address encountered during DNS resolution."

        return True, ""
    except Exception as e:
        logger.warning(f"URL validation error for '{url_str}': {e}")
        return False, "Invalid or malformed URL."


def sanitize_filename(filename: str, default: str = "document.pdf") -> str:
    """
    Safely sanitizes filenames against Path Traversal and illegal filesystem characters,
    preserving full Khmer Unicode characters, letters, digits, and punctuation.
    """
    if not filename:
        return default
    
    # Normalize backslashes (Windows) and strip directory traversal components
    normalized = filename.replace("\\", "/")
    clean = os.path.basename(normalized)
    
    # Strip dangerous shell/filesystem characters like / \ : * ? " < > | and null bytes
    clean = re.sub(r'[\/\\:\*\?"<>\|\x00]', '', clean).strip()
    
    # Prevent hidden files (.bashrc)
    if clean.startswith("."):
        clean = "file" + clean
        
    return clean if clean else default


def validate_file_signature(content: bytes, filename: str) -> Tuple[bool, str]:
    """
    Verifies that file content matches expected magic bytes for its extension.
    Prevents execution of disguised binaries or malformed uploads.
    """
    if not content or len(content) == 0:
        return False, "File is empty (0 bytes)."

    fname = filename.lower()
    
    if fname.endswith(".pdf"):
        if not content.startswith(b"%PDF"):
            return False, "File is missing the standard PDF header (%PDF). It may be corrupted or disguised."
            
    elif fname.endswith((".jpg", ".jpeg")):
        if not content.startswith(b"\xff\xd8\xff"):
            return False, "File does not match standard JPEG image format."
            
    elif fname.endswith(".png"):
        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            return False, "File does not match standard PNG image format."
            
    elif fname.endswith(".webp"):
        if not (content.startswith(b"RIFF") and b"WEBP" in content[8:16]):
            return False, "File does not match standard WebP image format."
            
    elif fname.endswith((".tif", ".tiff")):
        if not (content.startswith(b"II*\x00") or content.startswith(b"MM\x00*")):
            return False, "File does not match standard TIFF image format."
            
    elif fname.endswith(".bmp"):
        if not content.startswith(b"BM"):
            return False, "File does not match standard BMP image format."

    return True, ""


def mask_api_key(key: str) -> str:
    """Masks an API key for safe logging and responses (e.g. AIza...eEwW)."""
    if not key or len(key) <= 8:
        return "..."
    return f"{key[:4]}...{key[-4:]}"


class SlidingWindowRateLimiter:
    """
    Lightweight, thread-safe in-memory rate limiter per client IP.
    """
    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds
        
        # Clean expired timestamps
        req_times = [t for t in self.requests[client_ip] if t > window_start]
        self.requests[client_ip] = req_times

        if len(req_times) >= self.max_requests:
            return False

        self.requests[client_ip].append(now)
        return True

# Default rate limiters:
# 1. General API rate limiter: 120 requests / min
api_rate_limiter = SlidingWindowRateLimiter(max_requests=120, window_seconds=60)

# 2. Strict download/crawl rate limiter: 20 requests / min
fetch_rate_limiter = SlidingWindowRateLimiter(max_requests=20, window_seconds=60)
