"""Analysis endpoints: historical monthly statistics and wave return-period estimation."""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import extract, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.observations import MarineObservation, WeatherObservation

router = APIRouter(tags=["analysis"])
REFERENCE_MARINE_SOURCE = "open_meteo_marine_info"


# ---------------------------------------------------------------------------
# Helper: Gumbel fitting
# ---------------------------------------------------------------------------

def _fit_gumbel(data: list[float]) -> tuple[float, float]:
    """Method of moments Gumbel (EV-I) fit. Returns (u, beta)."""
    arr = np.array(data, dtype=float)
    sigma = float(arr.std(ddof=1)) if len(arr) > 1 else float(arr.std())
    beta = sigma * np.sqrt(6) / np.pi          # scale
    u = float(arr.mean()) - 0.5772 * beta       # location (Euler–Mascheroni)
    return u, beta


def _gumbel_quantile(u: float, beta: float, T: float) -> float:
    p = 1.0 - 1.0 / T
    return u - beta * float(np.log(-np.log(p)))


# ---------------------------------------------------------------------------
# Helper: Weibull fitting (log-linear, Gringorten plotting position)
# ---------------------------------------------------------------------------

def _fit_weibull(data: list[float]) -> tuple[float, float]:
    """Log-linear regression Weibull fit. Returns (k, lambda)."""
    arr = sorted(data)
    n = len(arr)
    p_i = [(i - 0.44) / (n + 0.12) for i in range(1, n + 1)]
    y = np.log(-np.log([1.0 - pi for pi in p_i]))
    x = np.log(arr)
    coeffs = np.polyfit(y, x, 1)       # y = b*x + a  →  b=coeffs[0], a=coeffs[1]
    b, a = float(coeffs[0]), float(coeffs[1])
    k = 1.0 / b
    lam = float(np.exp(a))
    return k, lam


def _weibull_quantile(k: float, lam: float, T: float) -> float:
    p = 1.0 - 1.0 / T
    return lam * float((-np.log(1.0 - p)) ** (1.0 / k))


# ---------------------------------------------------------------------------
# GET /observations/historical
# ---------------------------------------------------------------------------

@router.get("/observations/historical")
async def historical_statistics(
    site_id: uuid.UUID = Query(..., description="対象サイトID"),
    year: int = Query(default=None, description="集計対象年（省略時: 現在年）"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """月次集計統計エンドポイント。

    指定サイト・指定年の気象観測 + 海象観測データを月単位で集計して返す。
    """
    if year is None:
        year = datetime.now(timezone.utc).year

    # --- Weather observations ---
    w_stmt = (
        select(WeatherObservation)
        .where(WeatherObservation.site_id == site_id)
        .where(extract("year", WeatherObservation.observed_at) == year)
        .order_by(WeatherObservation.observed_at)
    )
    w_rows = (await db.execute(w_stmt)).scalars().all()

    # --- Marine observations ---
    m_stmt = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .where(or_(
            MarineObservation.source.is_(None),
            MarineObservation.source != REFERENCE_MARINE_SOURCE,
        ))
        .where(extract("year", MarineObservation.observed_at) == year)
        .order_by(MarineObservation.observed_at)
    )
    m_rows = (await db.execute(m_stmt)).scalars().all()

    # --- Monthly buckets ---
    # weather
    w_wind: dict[int, list[float]] = defaultdict(list)
    w_temp: dict[int, list[float]] = defaultdict(list)
    w_rain: dict[int, list[float]] = defaultdict(list)

    for row in w_rows:
        month: int = row.observed_at.month
        if row.wind_speed_ms is not None:
            w_wind[month].append(row.wind_speed_ms)
        if row.temperature_c is not None:
            w_temp[month].append(row.temperature_c)
        if row.precip_mm is not None:
            w_rain[month].append(row.precip_mm)

    # marine
    m_wave: dict[int, list[float]] = defaultdict(list)
    for row in m_rows:
        month = row.observed_at.month
        if row.sig_wave_h_m is not None:
            m_wave[month].append(row.sig_wave_h_m)

    # --- Aggregate ---
    months_out: list[dict[str, Any]] = []
    for m in range(1, 13):
        winds = w_wind.get(m, [])
        temps = w_temp.get(m, [])
        rains = w_rain.get(m, [])
        waves = m_wave.get(m, [])

        months_out.append({
            "month": m,
            "avg_wind_ms":  round(float(np.mean(winds)), 3) if winds else None,
            "max_wind_ms":  round(float(np.max(winds)), 3)  if winds else None,
            "avg_temp_c":   round(float(np.mean(temps)), 3) if temps else None,
            "total_rain_mm": round(float(sum(rains)), 3)    if rains else None,
            "rain_days":    sum(1 for r in rains if r > 0)  if rains else None,
            "avg_wave_h_m": round(float(np.mean(waves)), 3) if waves else None,
            "max_wave_h_m": round(float(np.max(waves)), 3)  if waves else None,
        })

    return {
        "site_id": str(site_id),
        "year": year,
        "data_source": "backend",
        "months": months_out,
    }


# ---------------------------------------------------------------------------
# GET /analysis/wave50
# ---------------------------------------------------------------------------

_RETURN_PERIODS = [2, 5, 10, 20, 50, 100]


@router.get("/analysis/wave50")
async def wave_return_period(
    site_id: uuid.UUID = Query(..., description="対象サイトID"),
    method: str = Query(default="gumbel", description="統計手法: gumbel | weibull"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """50年確率波推算エンドポイント。

    年最大有義波高を用いて Gumbel または Weibull 分布にフィットし、
    各再現期間の設計波高を返す。
    """
    if method not in ("gumbel", "weibull"):
        raise HTTPException(status_code=422, detail="method は 'gumbel' または 'weibull' を指定してください")

    # --- Fetch all marine observations for this site ---
    stmt = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .where(MarineObservation.sig_wave_h_m.isnot(None))
        .where(or_(
            MarineObservation.source.is_(None),
            MarineObservation.source != REFERENCE_MARINE_SOURCE,
        ))
        .order_by(MarineObservation.observed_at)
    )
    rows = (await db.execute(stmt)).scalars().all()

    if len(rows) < 2:
        raise HTTPException(
            status_code=422,
            detail="波高データが2件未満のため確率波推算を実行できません",
        )

    # --- Annual maxima ---
    year_max: dict[int, float] = {}
    for row in rows:
        y = row.observed_at.year
        h = row.sig_wave_h_m
        if h is not None:
            if y not in year_max or h > year_max[y]:
                year_max[y] = h

    annual_max_list = sorted(year_max.items())   # [(year, max_h), ...]
    data_values = [v for _, v in annual_max_list]
    data_years = len(data_values)

    if data_years < 2:
        raise HTTPException(
            status_code=422,
            detail="年最大波高のデータが2年分未満のため推算できません",
        )

    # --- Fit distribution ---
    return_period_rows: list[dict[str, Any]] = []

    if method == "gumbel":
        u, beta = _fit_gumbel(data_values)
        for T in _RETURN_PERIODS:
            h = _gumbel_quantile(u, beta, float(T))
            return_period_rows.append({
                "period_years": T,
                "wave_h_m": round(h, 3),
                "warning": None,
            })
    else:  # weibull
        # weibull log-linear requires all-positive values
        if any(v <= 0 for v in data_values):
            raise HTTPException(
                status_code=422,
                detail="Weibull 法には正の波高データが必要です（0以下の値が含まれています）",
            )
        k, lam = _fit_weibull(data_values)
        for T in _RETURN_PERIODS:
            h = _weibull_quantile(k, lam, float(T))
            return_period_rows.append({
                "period_years": T,
                "wave_h_m": round(h, 3),
                "warning": None,
            })

    note: str | None = (
        "データが10年未満のため推定精度が低い可能性があります"
        if data_years < 10
        else None
    )

    return {
        "site_id": str(site_id),
        "method": method,
        "data_years": data_years,
        "sufficient_data": data_years >= 10,
        "annual_max": [
            {"year": y, "max_wave_h_m": round(h, 3)}
            for y, h in annual_max_list
        ],
        "return_periods": return_period_rows,
        **({"note": note} if note else {}),
    }
