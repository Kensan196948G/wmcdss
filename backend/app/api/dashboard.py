"""Dashboard summary endpoint.

GET /api/v1/dashboard — 全現場の「いま」の判定要約を返す。

ブラウザのダッシュボード・現場一覧が個別の API を束ねず 1 リクエストで
現在状態を描画できるようにするための集約エンドポイント。判定ロジックは
`app.services.decision.evaluate` と同一の純関数を使い、work_type ごとの
最悪ケースを現場の代表ステータスとする。モック・生成値は一切返さない。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserInfo, get_current_user_or_anon
from app.db.session import get_db
from app.models.observations import MarineObservation, WeatherObservation
from app.models.site import Site
from app.models.threshold import Threshold
from app.services.decision import ThresholdRule, evaluate, is_rule_in_effect

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# 現場種別ごとに判定対象とする代表的な作業種別。
# marine/both は陸上作業（concrete/crane）に加えて海上作業を判定する。
_WORK_TYPES_BY_KIND = {
    "land": ("concrete", "crane"),
    "marine": ("concrete", "crane", "marine_lift", "marine_dive", "marine_transport"),
    "both": ("concrete", "crane", "marine_lift", "marine_dive", "marine_transport"),
}

# 判定入力として許容する観測値の鮮度（気象は 30 分、海象は 3 時間）。
_WEATHER_FRESH = timedelta(minutes=30)
_MARINE_FRESH = timedelta(hours=3)


async def _latest_inputs(
    db: AsyncSession,
    site_id: uuid.UUID,
    now: datetime,
) -> tuple[dict[str, float | None], datetime | None, datetime | None]:
    wq = (
        select(WeatherObservation)
        .where(WeatherObservation.site_id == site_id)
        .where(WeatherObservation.observed_at >= now - timedelta(hours=24))
        .order_by(WeatherObservation.observed_at.desc())
        .limit(1)
    )
    mq = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .where(MarineObservation.observed_at >= now - timedelta(hours=24))
        .where(or_(
            MarineObservation.source.is_(None),
            MarineObservation.source != "open_meteo_marine_info",
        ))
        .order_by(MarineObservation.observed_at.desc())
        .limit(1)
    )
    w = (await db.execute(wq)).scalars().first()
    m = (await db.execute(mq)).scalars().first()

    inputs = {
        "temperature_c": w.temperature_c if w else None,
        "humidity_pct": w.humidity_pct if w else None,
        "precip_mm_1h": w.precip_mm if w else None,
        "wind_speed_ms": w.wind_speed_ms if w else None,
        "wind_gust_ms": w.wind_gust_ms if w else None,
        "sig_wave_h_m": m.sig_wave_h_m if m else None,
        "wave_period_s": m.wave_period_s if m else None,
    }
    return inputs, (w.observed_at if w else None), (m.observed_at if m else None)


@router.get("")
async def dashboard_summary(
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """全現場の現在判定サマリーを返す。"""
    now = datetime.now(timezone.utc)
    sites = (await db.execute(select(Site).order_by(Site.code))).scalars().all()

    # 全現場分の閾値と観測値を一度に取得（N+1 を避ける）
    site_ids = [s.id for s in sites]
    thresholds_by_site: dict[uuid.UUID | None, list[Threshold]] = {}
    if site_ids:
        trows = (
            await db.execute(
                select(Threshold).where(or_(
                    Threshold.site_id.in_(site_ids),
                    Threshold.site_id.is_(None),
                ))
            )
        ).scalars().all()
        for t in trows:
            thresholds_by_site.setdefault(t.site_id, []).append(t)

    summaries: list[dict[str, Any]] = []
    for site in sites:
        work_types = _WORK_TYPES_BY_KIND.get(site.kind, ("concrete", "crane"))
        rows = [
            t for t in thresholds_by_site.get(site.id, [])
        ] + thresholds_by_site.get(None, [])
        by_work: dict[str, list[Threshold]] = {}
        for t in rows:
            if t.work_type in work_types:
                by_work.setdefault(t.work_type, []).append(t)

        inputs, w_at, m_at = await _latest_inputs(db, site.id, now)
        per_work: list[dict[str, Any]] = []
        worst = "go"
        worst_reason = "しきい値が設定されていません"

        for wt in work_types:
            rules_rows = by_work.get(wt, [])
            if not rules_rows:
                continue  # 作業種別に閾値が未設定なら判定対象外
            active: list[ThresholdRule] = []
            out_of_effect: list[dict[str, Any]] = []
            for r in rules_rows:
                if is_rule_in_effect(
                    active_from=r.active_from, active_to=r.active_to,
                    window_start=now - timedelta(hours=3), window_end=now,
                ):
                    active.append(ThresholdRule(
                        work_type=r.work_type, metric=r.metric, op=r.op,
                        value=r.value, severity=r.severity, note=r.note,
                    ))
                else:
                    out_of_effect.append({"work_type": r.work_type, "metric": r.metric})

            res = evaluate(
                work_type=wt, inputs=inputs, rules=active,
                out_of_effect=out_of_effect,
            )
            severity = {"go": 0, "caution": 1, "stop": 2}
            if severity[res.status] > severity[worst]:
                worst = res.status
                worst_reason = res.reason
            per_work.append({
                "work_type": wt,
                "status": res.status,
                "reason": res.reason,
                "evaluated": res.evaluated_count,
            })

        w_fresh = w_at is not None and (now - w_at) <= _WEATHER_FRESH
        m_fresh = m_at is not None and (now - m_at) <= _MARINE_FRESH
        summaries.append({
            "site_id": str(site.id),
            "code": site.code,
            "name": site.name,
            "kind": site.kind,
            "status": worst,
            "reason": worst_reason,
            "work_types": per_work,
            "weather_observed_at": w_at.isoformat() if w_at else None,
            "marine_observed_at": m_at.isoformat() if m_at else None,
            "weather_fresh": w_fresh,
            "marine_fresh": m_fresh,
            "data_complete": bool(per_work),
            # カード表示用の最新実測値。モック値を一切含めない。
            "latest_weather": {
                "temperature_c": inputs.get("temperature_c"),
                "humidity_pct": inputs.get("humidity_pct"),
                "precip_mm": inputs.get("precip_mm_1h"),
                "wind_speed_ms": inputs.get("wind_speed_ms"),
                "wind_gust_ms": inputs.get("wind_gust_ms"),
            } if w_at else None,
            "latest_marine": {
                "sig_wave_h_m": inputs.get("sig_wave_h_m"),
                "wave_period_s": inputs.get("wave_period_s"),
            } if m_at else None,
        })

    return {
        "generated_at": now.isoformat(),
        "count": len(summaries),
        "sites": summaries,
    }
