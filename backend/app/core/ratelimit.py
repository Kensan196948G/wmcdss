"""In-memory rate limiter for mutation endpoints.

Identity: SHA-256 prefix of X-API-Key when the header is present, else client
IP. We hash so logs / bucket dumps never carry the raw key. Validation is
APIKeyMiddleware's job — this layer only buckets traffic by stable identity.

Algorithm: sliding-window deque per identity. On each hit we drop timestamps
older than the window and compare `len(dq)` to the configured cap.

Scope: process-local. Adequate for the single-backend deployment this project
ships with (one uvicorn container per host). When the topology grows to
multiple replicas, swap the bucket store for Redis without touching the
middleware seam.
"""
from __future__ import annotations
import hashlib
import logging
import time
from collections import deque
from typing import Deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core import config as _config

log = logging.getLogger(__name__)

# Cap distinct identities tracked. Prevents an attacker who rotates X-API-Key
# values from exhausting memory: when full we evict the oldest insertion.
_MAX_IDENTITIES = 4096

# Mirror APIKeyMiddleware's cap so an oversize header doesn't feed a huge
# string into sha256.
_MAX_KEY_LEN = 512


def _identity(request: Request) -> str:
    key = (request.headers.get("X-API-Key") or "")[:_MAX_KEY_LEN]
    if key:
        h = hashlib.sha256(key.encode("utf-8", "replace")).hexdigest()[:16]
        return "k:" + h
    host = request.client.host if request.client else "?"
    return "i:" + host


class _Buckets:
    """Sliding-window timestamp store with FIFO eviction at identity level."""

    def __init__(self) -> None:
        self._store: dict[str, Deque[float]] = {}

    def hit(
        self, identity: str, *, limit: int, window_s: float, now: float
    ) -> tuple[bool, int, float]:
        """Record a hit. Returns (allowed, remaining_after, reset_at)."""
        dq = self._store.get(identity)
        if dq is None:
            if len(self._store) >= _MAX_IDENTITIES:
                self._store.pop(next(iter(self._store)))
            dq = deque()
            self._store[identity] = dq

        cutoff = now - window_s
        while dq and dq[0] <= cutoff:
            dq.popleft()

        if len(dq) >= limit:
            reset_at = dq[0] + window_s
            return False, 0, reset_at

        dq.append(now)
        return True, limit - len(dq), now + window_s

    def reset(self) -> None:
        self._store.clear()


_buckets = _Buckets()


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        s = _config.get_settings()
        if s.rate_limit_per_minute <= 0:
            return await call_next(request)

        path = request.url.path
        if path in s.rate_limit_exempt_paths:
            return await call_next(request)
        if request.method.upper() not in s.rate_limit_methods:
            return await call_next(request)

        ident = _identity(request)
        allowed, remaining, reset_at = _buckets.hit(
            ident,
            limit=s.rate_limit_per_minute,
            window_s=60.0,
            now=time.monotonic(),
        )
        if not allowed:
            retry_after = max(1, int(round(reset_at - time.monotonic())))
            log.warning(
                "ratelimit: %s %s rejected ident=%s retry=%ss",
                request.method, path, ident, retry_after,
            )
            return JSONResponse(
                status_code=429,
                content={"detail": "rate limit exceeded"},
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(s.rate_limit_per_minute),
                    "X-RateLimit-Remaining": "0",
                },
            )
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(s.rate_limit_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
