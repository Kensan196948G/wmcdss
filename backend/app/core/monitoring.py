"""Prometheus metrics middleware and collector singletons.

Module-level Counter/Histogram are registered once at import time and shared
across the process.  Tests that need a clean slate can instantiate a fresh
CollectorRegistry() and pass it explicitly to generate_latest().
"""
from __future__ import annotations
import time

from prometheus_client import Counter, Histogram
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request


REQUEST_COUNT = Counter(
    "wmcdss_http_requests_total",
    "Total HTTP requests received by the backend",
    ["method", "path", "status_code"],
)
REQUEST_LATENCY = Histogram(
    "wmcdss_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Record request count and latency for every request that passes through."""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start
        path = request.url.path
        method = request.method
        REQUEST_COUNT.labels(
            method=method, path=path, status_code=str(response.status_code)
        ).inc()
        REQUEST_LATENCY.labels(method=method, path=path).observe(duration)
        return response
