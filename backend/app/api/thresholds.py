"""Threshold CRUD.

Listing rule
-------------
GET /thresholds?site_id=&work_type=
  - site_id given: returns rules where (site_id == X) OR (site_id IS NULL)
    so callers can see "what would apply" without needing to merge themselves.
  - site_id omitted: returns global defaults only (site_id IS NULL).
"""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserInfo, get_current_user_or_anon, require_admin_or_api_key
from app.core.security import actor_from
from app.db.session import get_db
from app.models.threshold import Threshold
from app.schemas.threshold import ThresholdCreate, ThresholdOut, ThresholdUpdate
from app.services.audit import write_audit

router = APIRouter(prefix="/thresholds", tags=["thresholds"])


@router.get("", response_model=list[ThresholdOut])
async def list_thresholds(
    site_id: uuid.UUID | None = Query(default=None),
    work_type: str | None = Query(default=None),
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    conds = []
    if site_id is not None:
        conds.append(or_(Threshold.site_id == site_id, Threshold.site_id.is_(None)))
    else:
        conds.append(Threshold.site_id.is_(None))
    if work_type:
        conds.append(Threshold.work_type == work_type)

    stmt = select(Threshold).where(and_(*conds)).order_by(
        Threshold.work_type, Threshold.metric, Threshold.severity
    )
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/{threshold_id}", response_model=ThresholdOut)
async def get_threshold(
    threshold_id: uuid.UUID,
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(Threshold).where(Threshold.id == threshold_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "threshold not found")
    return row


@router.post("", response_model=ThresholdOut, status_code=201)
async def create_threshold(
    payload: ThresholdCreate,
    request: Request,
    _admin: UserInfo = Depends(require_admin_or_api_key),
    db: AsyncSession = Depends(get_db),
):
    row = Threshold(**payload.model_dump())
    db.add(row)
    await db.flush()
    await write_audit(
        db, actor=actor_from(request), action="threshold.create",
        target_type="threshold", target_id=str(row.id),
        detail=payload.model_dump(mode="json"),
        strict=True,
    )
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/{threshold_id}", response_model=ThresholdOut)
async def update_threshold(
    threshold_id: uuid.UUID,
    payload: ThresholdUpdate,
    request: Request,
    _admin: UserInfo = Depends(require_admin_or_api_key),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(Threshold).where(Threshold.id == threshold_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "threshold not found")

    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(row, k, v)

    await write_audit(
        db, actor=actor_from(request), action="threshold.update",
        target_type="threshold", target_id=str(row.id),
        detail={"changes": changes},
        strict=True,
    )
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{threshold_id}", status_code=204)
async def delete_threshold(
    threshold_id: uuid.UUID,
    request: Request,
    _admin: UserInfo = Depends(require_admin_or_api_key),
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(Threshold).where(Threshold.id == threshold_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "threshold not found")
    await db.delete(row)
    await write_audit(
        db, actor=actor_from(request), action="threshold.delete",
        target_type="threshold", target_id=str(threshold_id),
        detail=None,
        strict=True,
    )
    await db.commit()
    return None
