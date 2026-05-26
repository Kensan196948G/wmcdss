"""Audit-log read API. Write is internal via app.services.audit."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.audit import AuditLog
from app.schemas.audit import AuditOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditOut])
async def list_audit(
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_type: str | None = Query(default=None),
    target_id: str | None = Query(default=None),
    t0: datetime | None = Query(default=None),
    t1: datetime | None = Query(default=None),
    limit: int = Query(default=200, le=1000),
    db: AsyncSession = Depends(get_db),
):
    t1 = t1 or datetime.now(timezone.utc)
    t0 = t0 or (t1 - timedelta(days=7))
    stmt = select(AuditLog).where(AuditLog.occurred_at.between(t0, t1))
    if actor:       stmt = stmt.where(AuditLog.actor == actor)
    if action:      stmt = stmt.where(AuditLog.action == action)
    if target_type: stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:   stmt = stmt.where(AuditLog.target_id == target_id)
    stmt = stmt.order_by(AuditLog.occurred_at.desc()).limit(limit)
    return (await db.execute(stmt)).scalars().all()
