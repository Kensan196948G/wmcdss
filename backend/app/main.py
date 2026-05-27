from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.security import APIKeyMiddleware
from app.core.ratelimit import RateLimitMiddleware
from app.core.monitoring import MetricsMiddleware
from app.api import health, sites, decisions, thresholds, observations, audit, metrics

settings = get_settings()

# OpenAPI exposure is env-controlled. Passing `openapi_url=None` removes the
# schema endpoint itself, which in turn makes /docs and /redoc 404 naturally —
# no need to also null those out explicitly, but doing so keeps the intent
# obvious to a future reader scanning main.py.
_fastapi_kwargs: dict = {"title": settings.app_name, "version": "0.1.0"}
if not settings.expose_openapi:
    _fastapi_kwargs.update(openapi_url=None, docs_url=None, redoc_url=None)

app = FastAPI(**_fastapi_kwargs)

# Order matters: Starlette runs the *last-added* middleware first, so the
# effective request flow is Metrics → CORS → RateLimit → APIKey → route.
#   - Metrics outermost: records every request including 401/429 rejections,
#     giving a complete picture of traffic (not just successful requests).
#   - CORS next: every response carries CORS headers before auth/rate checks.
#   - RateLimit above APIKey: drop floods before spending hmac.compare_digest.
app.add_middleware(APIKeyMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(MetricsMiddleware)

app.include_router(health.router)
app.include_router(metrics.router)
app.include_router(sites.router, prefix="/api/v1")
app.include_router(decisions.router, prefix="/api/v1")
app.include_router(thresholds.router, prefix="/api/v1")
app.include_router(observations.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")


@app.get("/")
async def root():
    return {
        "service": settings.app_name,
        "version": app.version,
        "docs": "/docs",
        "endpoints": [
            "/healthz",
            "/readyz",
            "/metrics",
            "/api/v1/sites",
            "/api/v1/decisions",
            "/api/v1/thresholds",
            "/api/v1/observations/weather",
            "/api/v1/observations/weather/latest",
            "/api/v1/observations/marine",
            "/api/v1/observations/marine/latest",
            "/api/v1/audit",
        ],
    }
