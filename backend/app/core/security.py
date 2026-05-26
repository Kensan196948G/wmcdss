"""API key middleware.

Read-side endpoints stay public (GET); mutations require X-API-Key matching one
of the configured keys. Empty `api_keys` disables enforcement (dev mode).

Key comparison uses `hmac.compare_digest` to avoid timing side-channels.
"""
from __future__ import annotations
import hmac
import logging

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core import config as _config

log = logging.getLogger(__name__)


def _key_matches(presented: str, allowed: list[str]) -> bool:
    for k in allowed:
        if hmac.compare_digest(presented, k):
            return True
    return False


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        s = _config.get_settings()
        if not s.api_keys:
            return await call_next(request)

        path = request.url.path
        # Exact match always exempts. Prefix match only when configured path ends
        # with "/" (e.g. "/docs/") or has a non-root prefix — guards against the
        # "/" entry matching every URL.
        def _exempt(p: str) -> bool:
            if path == p:
                return True
            if p == "/":
                return False
            prefix = p if p.endswith("/") else p + "/"
            return path.startswith(prefix)
        if any(_exempt(p) for p in s.auth_exempt_paths):
            return await call_next(request)
        if request.method.upper() not in s.auth_required_methods:
            return await call_next(request)

        presented = request.headers.get("X-API-Key", "")
        if not presented or not _key_matches(presented, s.api_keys):
            log.warning("auth: %s %s rejected (ip=%s)",
                        request.method, path,
                        request.client.host if request.client else "?")
            return JSONResponse(
                status_code=401,
                content={"detail": "missing or invalid X-API-Key"},
            )
        return await call_next(request)
