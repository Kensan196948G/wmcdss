from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz():
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(response: Response, db: AsyncSession = Depends(get_db)):
    # Orchestrators (k8s, docker, LB) decide readiness from the HTTP status
    # code, not the JSON body. Returning 200 with status="degraded" on DB
    # failure silently keeps traffic flowing into a backend that cannot
    # serve queries — must surface as 503 so probes fail fast.
    try:
        await db.execute(text("SELECT 1"))
        return {"status": "ready", "db": "ok"}
    except Exception as exc:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "db": str(exc)}
