"""ETL job management endpoints.

Provides manual trigger and status endpoints for background data ingestion jobs.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
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
        "name": "波浪ナウキャスト取得",
        "source": "気象庁 波浪ナウキャスト",
        "schedule": "1時間毎",
        "module": "app.jobs.ingest_jma_marine",
    },
}


def _background_run(module_path: str, job_id: int) -> None:
    """Run a job's run_once() coroutine in a new event loop (background thread)."""
    import importlib

    async def _run() -> None:
        mod = importlib.import_module(module_path)
        result = await mod.run_once()
        log.info("etl job_id=%d finished: %s", job_id, result)

    try:
        asyncio.run(_run())
    except Exception as exc:  # pylint: disable=broad-except
        log.error("etl job_id=%d failed: %s", job_id, exc, exc_info=True)


# ---------------------------------------------------------------------------
# POST /etl/run/{job_id}
# ---------------------------------------------------------------------------

@router.post("/run/{job_id}")
async def run_etl_job(
    job_id: int,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """ETL ジョブを手動で開始する。

    ジョブは BackgroundTasks で非同期実行される。
    レスポンスは即座に返る。
    """
    if job_id not in _JOB_META:
        raise HTTPException(
            status_code=404,
            detail=f"job_id={job_id} は存在しません。有効な値: {sorted(_JOB_META)}",
        )

    meta = _JOB_META[job_id]
    background_tasks.add_task(_background_run, meta["module"], job_id)

    return {
        "status": "started",
        "job_id": job_id,
        "message": f"{meta['name']} を開始しました ({meta['source']})",
    }


# ---------------------------------------------------------------------------
# GET /etl/status
# ---------------------------------------------------------------------------

@router.get("/status")
async def etl_status(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """全 ETL ジョブのステータスを返す。

    最新の観測レコードのタイムスタンプからジョブの最終実行を推定する。
    """
    # Latest WeatherObservation timestamp
    w_stmt = (
        select(WeatherObservation.observed_at)
        .order_by(WeatherObservation.observed_at.desc())
        .limit(1)
    )
    w_result = (await db.execute(w_stmt)).scalar_one_or_none()

    # Latest MarineObservation timestamp
    m_stmt = (
        select(MarineObservation.observed_at)
        .order_by(MarineObservation.observed_at.desc())
        .limit(1)
    )
    m_result = (await db.execute(m_stmt)).scalar_one_or_none()

    def _status(last_obs_at: Any) -> str:
        return "ok" if last_obs_at is not None else "unknown"

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
            "last_obs_at": _fmt(w_result),
            "status": _status(w_result),
        },
        {
            "id": 2,
            "name": _JOB_META[2]["name"],
            "source": _JOB_META[2]["source"],
            "schedule": _JOB_META[2]["schedule"],
            "last_obs_at": _fmt(m_result),
            "status": _status(m_result),
        },
    ]

    return {"jobs": jobs}
