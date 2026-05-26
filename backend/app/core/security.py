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


# Cap header length before any work: prevents CPU amplification by oversize
# X-API-Key headers and bounds the bytes we pass to hmac.compare_digest.
_MAX_KEY_LEN = 512

# Actor field length cap mirrors AuditLog.actor column constraint. Trimming at
# the boundary keeps DB writes from ever exploding into "X-Actor too long" 500s
# and makes the audit table grep-friendly.
_MAX_ACTOR_LEN = 64


def actor_from(request: Request) -> str:
    """Resolve the audit `actor` for a mutating request.

    Only `X-Actor` is honoured. Falling back to `X-API-Key` would leak the
    credential into `audit_log.actor`, which `GET /api/v1/audit` exposes
    unauthenticated. When no `X-Actor` is supplied, "anonymous" is used and
    a warning is logged so a sustained absence in production is visible.
    """
    raw = (request.headers.get("X-Actor") or "").strip()
    if not raw:
        log.warning("audit: %s %s missing X-Actor; recording actor=anonymous",
                    request.method, request.url.path)
        return "anonymous"
    return raw[:_MAX_ACTOR_LEN]


def _key_matches(presented: str, allowed: list[str]) -> bool:
    if not presented or len(presented) > _MAX_KEY_LEN:
        return False
    # compare_digest raises TypeError if either str contains non-ASCII; encode
    # to bytes so a client sending e.g. `X-API-Key: 鍵` becomes a clean 401
    # instead of an unhandled 500 (which would leak a stack trace and enable DoS).
    try:
        pb = presented.encode("utf-8")
    except (AttributeError, UnicodeError):
        return False
    for k in allowed:
        if hmac.compare_digest(pb, k.encode("utf-8")):
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
