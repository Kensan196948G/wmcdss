from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import actor_from
from app.db.session import get_db
from app.models.observations import WeatherObservation, MarineObservation
from app.models.threshold import Threshold
from app.models.decision import Decision
from app.schemas.decision import DecisionRequest, DecisionOut
from app.services.audit import write_audit
from app.services.decision import ThresholdRule, evaluate

router = APIRouter(prefix="/decisions", tags=["decisions"])


async def _load_thresholds(db: AsyncSession, site_id, work_type: str) -> list[ThresholdRule]:
    stmt = select(Threshold).where(
        and_(
            Threshold.work_type == work_type,
            (Threshold.site_id == site_id) | (Threshold.site_id.is_(None)),
        )
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        ThresholdRule(
            work_type=r.work_type, metric=r.metric, op=r.op,
            value=r.value, severity=r.severity, note=r.note,
        )
        for r in rows
    ]


async def _latest_inputs(db: AsyncSession, site_id, t0, t1) -> dict[str, float | None]:
    wq = (
        select(WeatherObservation)
        .where(WeatherObservation.site_id == site_id)
        .where(WeatherObservation.observed_at.between(t0 - timedelta(hours=3), t1))
        .order_by(WeatherObservation.observed_at.desc())
    )
    mq = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .where(MarineObservation.observed_at.between(t0 - timedelta(hours=3), t1))
        .where(or_(
            MarineObservation.source.is_(None),
            MarineObservation.source != "open_meteo_marine_info",
        ))
        .order_by(MarineObservation.observed_at.desc())
    )
    w = (await db.execute(wq)).scalars().first()
    m = (await db.execute(mq)).scalars().first()

    return {
        "temperature_c":  w.temperature_c  if w else None,
        "humidity_pct":   w.humidity_pct   if w else None,
        "precip_mm_1h":   w.precip_mm      if w else None,
        "wind_speed_ms":  w.wind_speed_ms  if w else None,
        "wind_gust_ms":   w.wind_gust_ms   if w else None,
        "sig_wave_h_m":   m.sig_wave_h_m   if m else None,
        "wave_period_s":  m.wave_period_s  if m else None,
    }


@router.post("", response_model=DecisionOut)
async def create_decision(
    req: DecisionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if req.target_window_end <= req.target_window_start:
        raise HTTPException(400, "target_window_end must be after target_window_start")

    rules = await _load_thresholds(db, req.site_id, req.work_type)
    inputs = await _latest_inputs(db, req.site_id, req.target_window_start, req.target_window_end)
    res = evaluate(work_type=req.work_type, inputs=inputs, rules=rules)

    decision = Decision(
        site_id=req.site_id,
        work_type=req.work_type,
        target_window_start=req.target_window_start,
        target_window_end=req.target_window_end,
        status=res.status,
        reason=res.reason,
        inputs=inputs,
        thresholds_snapshot={"rules": res.matched_rules},
    )
    db.add(decision)
    await db.flush()

    # Audit: README promises actor + inputs + judgement are persisted on every
    # decision. The detail payload mirrors what a human would need to reconstruct
    # the decision after the fact (inputs snapshot, status, matched rules).
    await write_audit(
        db, actor=actor_from(request), action="decision.create",
        target_type="decision", target_id=str(decision.id),
        detail={
            "site_id": str(req.site_id),
            "work_type": req.work_type,
            "window": {
                "start": req.target_window_start.isoformat(),
                "end": req.target_window_end.isoformat(),
            },
            "status": res.status,
            "reason": res.reason,
            "inputs": inputs,
            "matched_rules": res.matched_rules,
        },
        strict=True,
    )
    await db.commit()
    await db.refresh(decision)
    return decision
