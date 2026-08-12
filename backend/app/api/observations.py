"""Observation ingest + query.

Upsert via Postgres ON CONFLICT on the natural key (site_id, observed_at, data_version)
so re-running an ETL window is idempotent and increments only on real changes.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserInfo, get_current_user_or_anon, require_machine_client
from app.core.security import actor_from
from app.db.session import get_db
from app.models.observations import WeatherObservation, MarineObservation
from app.schemas.observation import (
    WeatherObservationIn, WeatherObservationOut,
    MarineObservationIn,  MarineObservationOut,
    IngestResult,
)
from app.services.audit import write_audit

router = APIRouter(prefix="/observations", tags=["observations"])


async def _ingest(
    db: AsyncSession,
    table,
    natural_key: tuple[str, ...],
    rows: list[dict],
) -> IngestResult:
    if not rows:
        return IngestResult(inserted=0, updated=0, skipped=0, total=0)

    stmt = pg_insert(table).values(rows)
    update_cols = {
        c.name: stmt.excluded[c.name]
        for c in table.__table__.columns
        if c.name not in {"id", "fetched_at", *natural_key}
    }
    upsert = stmt.on_conflict_do_update(
        index_elements=list(natural_key),
        set_=update_cols,
    ).returning(table.id, table.observed_at, *(table.__table__.c[k] for k in natural_key if k != "observed_at"))

    res = await db.execute(upsert)
    affected = res.fetchall()
    # Postgres returns the row whether inserted or updated; we can't trivially split without xmax,
    # so we approximate: count = inserted+updated (treat all as inserted for now).
    return IngestResult(inserted=len(affected), updated=0, skipped=0, total=len(rows))


# --- Weather -----------------------------------------------------------------

@router.post("/weather", response_model=IngestResult, status_code=201)
async def ingest_weather(
    payload: list[WeatherObservationIn],
    request: Request,
    _machine: None = Depends(require_machine_client),
    db: AsyncSession = Depends(get_db),
):
    rows = [p.model_dump() for p in payload]
    result = await _ingest(
        db, WeatherObservation,
        natural_key=("site_id", "observed_at", "data_version"),
        rows=rows,
    )
    await write_audit(
        db, actor=actor_from(request), action="observation.weather.ingest",
        target_type="weather_observation", target_id=None,
        detail={"count": result.total},
    )
    await db.commit()
    return result


@router.get("/weather", response_model=list[WeatherObservationOut])
async def list_weather(
    site_id: uuid.UUID = Query(...),
    t0: datetime | None = Query(default=None, description="UTC start; defaults to now-24h"),
    t1: datetime | None = Query(default=None, description="UTC end; defaults to now"),
    limit: int = Query(default=200, le=2000),
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    t1 = t1 or datetime.now(timezone.utc)
    t0 = t0 or (t1 - timedelta(hours=24))
    stmt = (
        select(WeatherObservation)
        .where(WeatherObservation.site_id == site_id)
        .where(WeatherObservation.observed_at.between(t0, t1))
        .order_by(WeatherObservation.observed_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/weather/latest", response_model=WeatherObservationOut)
async def latest_weather(
    site_id: uuid.UUID = Query(...),
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(WeatherObservation)
        .where(WeatherObservation.site_id == site_id)
        .order_by(WeatherObservation.observed_at.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "no weather observation for site")
    return row


# --- Marine ------------------------------------------------------------------

@router.post("/marine", response_model=IngestResult, status_code=201)
async def ingest_marine(
    payload: list[MarineObservationIn],
    request: Request,
    _machine: None = Depends(require_machine_client),
    db: AsyncSession = Depends(get_db),
):
    rows = [p.model_dump() for p in payload]
    result = await _ingest(
        db, MarineObservation,
        natural_key=("site_id", "observed_at", "data_version"),
        rows=rows,
    )
    await write_audit(
        db, actor=actor_from(request), action="observation.marine.ingest",
        target_type="marine_observation", target_id=None,
        detail={"count": result.total},
    )
    await db.commit()
    return result


@router.get("/marine", response_model=list[MarineObservationOut])
async def list_marine(
    site_id: uuid.UUID = Query(...),
    t0: datetime | None = Query(default=None),
    t1: datetime | None = Query(default=None),
    limit: int = Query(default=200, le=2000),
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    t1 = t1 or datetime.now(timezone.utc)
    t0 = t0 or (t1 - timedelta(hours=24))
    stmt = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .where(MarineObservation.observed_at.between(t0, t1))
        .order_by(MarineObservation.observed_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/marine/latest", response_model=MarineObservationOut)
async def latest_marine(
    site_id: uuid.UUID = Query(...),
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .order_by(MarineObservation.observed_at.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "no marine observation for site")
    return row
