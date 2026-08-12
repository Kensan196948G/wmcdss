"""ETL job management endpoints.

Provides manual trigger and status endpoints for background data ingestion jobs.
"""
from __future__ import annotations

import importlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserInfo, get_current_user_or_anon, require_admin_jwt
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.observations import MarineObservation, WeatherObservation

log = logging.getLogger("wmcdss.api.etl")

router = APIRouter(prefix="/etl", tags=["etl"])

# ---------------------------------------------------------------------------
# Job registry
# ---------------------------------------------------------------------------

_JOB_META: dict[int, dict[str, str]] = {
    1: {
        "name": "AMeDAS気象データ取得",
        "source": "気象庁 AMeDAS",
        "schedule": "10分毎",
        "module": "app.jobs.ingest_jma",
    },
    2: {
        "name": "海象参考情報取得",
        "source": "Open-Meteo Marine API（情報共有用）",
        "schedule": "10分毎確認（参考情報・施工判断には使用しない）",
        "module": "app.jobs.ingest_jma_marine",
    },
}


# ---------------------------------------------------------------------------
# POST /etl/run/{job_id}
# ---------------------------------------------------------------------------

@router.post("/run/{job_id}")
async def run_etl_job(
    job_id: int,
    current_user: UserInfo = Depends(require_admin_jwt),
) -> dict[str, Any]:
    """ETL ジョブを手動で開始する。

    同一イベントループ内で run_once() を完了まで待つ。以前の BackgroundTasks
    + asyncio.run() 方式は、asyncpg の接続プールと別イベントループが混在し、
    手動実行だけ失敗することがあった。
    """
    if job_id not in _JOB_META:
        raise HTTPException(
            status_code=404,
            detail=f"job_id={job_id} は存在しません。有効な値: {sorted(_JOB_META)}",
        )

    meta = _JOB_META[job_id]
    log.info("etl job_id=%d started manually by %s", job_id, current_user.username)
    try:
        mod = importlib.import_module(meta["module"])
        rows_written = await mod.run_once()
    except Exception as exc:  # noqa: BLE001
        log.error("etl job_id=%d failed: %s", job_id, exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"{meta['name']} の実行に失敗しました",
        ) from exc

    return {
        "status": "finished",
        "job_id": job_id,
        "rows_written": rows_written,
        "message": f"{meta['name']} が完了しました ({meta['source']})",
    }


# ---------------------------------------------------------------------------
# GET /etl/status
# ---------------------------------------------------------------------------

@router.get("/status")
async def etl_status(
    _current_user: UserInfo = Depends(get_current_user_or_anon),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """全 ETL ジョブのステータスを返す。

    最新の観測レコードのタイムスタンプからジョブの最終実行を推定する。
    """
    weather_row = (
        await db.execute(
            select(
                func.count(WeatherObservation.id),
                func.max(WeatherObservation.observed_at),
            )
        )
    ).one()
    marine_row = (
        await db.execute(
            select(
                func.count(MarineObservation.id),
                func.max(MarineObservation.observed_at),
            )
        )
    ).one()
    weather_run = (
        await db.execute(
            select(AuditLog.occurred_at, AuditLog.detail)
            .where(AuditLog.action == "observation.weather.ingest")
            .order_by(AuditLog.occurred_at.desc())
            .limit(1)
        )
    ).one_or_none()
    marine_run = (
        await db.execute(
            select(AuditLog.occurred_at, AuditLog.detail)
            .where(AuditLog.action == "observation.marine.ingest")
            .order_by(AuditLog.occurred_at.desc())
            .limit(1)
        )
    ).one_or_none()

    def _as_aware(dt: datetime | None) -> datetime | None:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    def _status(last_obs_at: datetime | None, stale_after: timedelta) -> str:
        last_obs_at = _as_aware(last_obs_at)
        if last_obs_at is None:
            return "unknown"
        return "ok" if datetime.now(timezone.utc) - last_obs_at <= stale_after else "stale"

    def _marine_status(last_obs_at: datetime | None) -> str:
        if last_obs_at is not None:
            return _status(last_obs_at, timedelta(hours=2))
        detail = marine_run[1] if marine_run else None
        if isinstance(detail, dict) and detail.get("sites_total") == 0:
            return "not_configured"
        return "unknown"

    def _fmt(dt: Any) -> str | None:
        if dt is None:
            return None
        if hasattr(dt, "isoformat"):
            return dt.isoformat()
        return str(dt)

    jobs = [
        {
            "id": 1,
            "name": _JOB_META[1]["name"],
            "source": _JOB_META[1]["source"],
            "schedule": _JOB_META[1]["schedule"],
            "last_obs_at": _fmt(weather_row[1]),
            "last_run_at": _fmt(weather_run[0] if weather_run else None),
            "status": _status(weather_row[1], timedelta(minutes=30)),
            "records": int(weather_row[0] or 0),
        },
        {
            "id": 2,
            "name": _JOB_META[2]["name"],
            "source": _JOB_META[2]["source"],
            "schedule": _JOB_META[2]["schedule"],
            "last_obs_at": _fmt(marine_row[1]),
            "last_run_at": _fmt(marine_run[0] if marine_run else None),
            "status": _marine_status(marine_row[1]),
            "records": int(marine_row[0] or 0),
        },
    ]

    return {"jobs": jobs}
