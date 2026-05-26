from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.security import APIKeyMiddleware
from app.api import health, sites, decisions, thresholds, observations, audit

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")

# Order matters: CORS must wrap auth so 401 responses also carry CORS headers.
app.add_middleware(APIKeyMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
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
