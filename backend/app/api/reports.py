"""Report generation endpoint.

Generates CSV or Excel (xlsx) files from observation and audit data.
Falls back to CSV if openpyxl is not installed.
"""
from __future__ import annotations

import io
import csv
import uuid
from datetime import date, datetime, timezone
from typing import Literal, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.observations import MarineObservation, WeatherObservation

try:
    import openpyxl
    _OPENPYXL_AVAILABLE = True
except ImportError:
    _OPENPYXL_AVAILABLE = False

router = APIRouter(tags=["reports"])


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class ReportRequest(BaseModel):
    site_id: uuid.UUID
    template: Literal["daily", "weekly", "monthly", "decision", "marine", "annual"]
    date_from: str   # YYYY-MM-DD
    date_to: str     # YYYY-MM-DD
    format: Literal["csv", "excel"] = "csv"


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _parse_date(s: str, end_of_day: bool = False) -> datetime:
    """Parse YYYY-MM-DD string to timezone-aware UTC datetime."""
    try:
        d = date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"日付形式が不正です: {s!r} (YYYY-MM-DD)")
    if end_of_day:
        return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)
    return datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)


def _isoformat(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


# ---------------------------------------------------------------------------
# Template builders — return (headers, rows)
# ---------------------------------------------------------------------------

def _build_daily(
    weather_rows: list[WeatherObservation],
    marine_rows: list[MarineObservation],
) -> tuple[list[str], list[list[Any]]]:
    headers = [
        "observed_at", "temperature_c", "humidity_pct", "pressure_hpa",
        "precip_mm", "wind_speed_ms", "wind_gust_ms", "wind_dir_deg",
        "sunshine_h", "sig_wave_h_m", "wave_period_s", "wave_dir_deg",
        "tide_level_m", "current_speed_ms",
    ]
    # Index marine by observed_at for join
    marine_idx: dict[datetime, MarineObservation] = {r.observed_at: r for r in marine_rows}

    # Collect all timestamps from both sources
    all_ts: set[datetime] = {r.observed_at for r in weather_rows} | set(marine_idx)
    weather_idx: dict[datetime, WeatherObservation] = {r.observed_at: r for r in weather_rows}

    rows_out: list[list[Any]] = []
    for ts in sorted(all_ts):
        w = weather_idx.get(ts)
        m = marine_idx.get(ts)
        rows_out.append([
            _isoformat(ts),
            w.temperature_c  if w else None,
            w.humidity_pct   if w else None,
            w.pressure_hpa   if w else None,
            w.precip_mm      if w else None,
            w.wind_speed_ms  if w else None,
            w.wind_gust_ms   if w else None,
            w.wind_dir_deg   if w else None,
            w.sunshine_h     if w else None,
            m.sig_wave_h_m   if m else None,
            m.wave_period_s  if m else None,
            m.wave_dir_deg   if m else None,
            m.tide_level_m   if m else None,
            m.current_speed_ms if m else None,
        ])
    return headers, rows_out


def _build_weekly(
    weather_rows: list[WeatherObservation],
    marine_rows: list[MarineObservation],
) -> tuple[list[str], list[list[Any]]]:
    from collections import defaultdict

    def iso_week(dt: datetime) -> str:
        return dt.strftime("%Y-W%V")

    w_buckets: dict[str, list[WeatherObservation]] = defaultdict(list)
    for r in weather_rows:
        w_buckets[iso_week(r.observed_at)].append(r)

    m_buckets: dict[str, list[MarineObservation]] = defaultdict(list)
    for r in marine_rows:
        m_buckets[iso_week(r.observed_at)].append(r)

    headers = [
        "week", "avg_temp_c", "max_wind_ms", "total_rain_mm",
        "avg_wave_h_m", "max_wave_h_m",
    ]
    all_weeks = sorted(set(w_buckets) | set(m_buckets))
    rows_out: list[list[Any]] = []
    import numpy as np
    for wk in all_weeks:
        ws = w_buckets.get(wk, [])
        ms = m_buckets.get(wk, [])
        temps  = [r.temperature_c  for r in ws if r.temperature_c  is not None]
        winds  = [r.wind_speed_ms  for r in ws if r.wind_speed_ms  is not None]
        rains  = [r.precip_mm      for r in ws if r.precip_mm      is not None]
        waves  = [r.sig_wave_h_m   for r in ms if r.sig_wave_h_m   is not None]
        rows_out.append([
            wk,
            round(float(np.mean(temps)), 3) if temps else None,
            round(float(np.max(winds)),  3) if winds else None,
            round(float(sum(rains)),     3) if rains else None,
            round(float(np.mean(waves)), 3) if waves else None,
            round(float(np.max(waves)),  3) if waves else None,
        ])
    return headers, rows_out


def _build_monthly(
    weather_rows: list[WeatherObservation],
    marine_rows: list[MarineObservation],
) -> tuple[list[str], list[list[Any]]]:
    from collections import defaultdict
    import numpy as np

    def ym(dt: datetime) -> str:
        return dt.strftime("%Y-%m")

    w_buckets: dict[str, list[WeatherObservation]] = defaultdict(list)
    for r in weather_rows:
        w_buckets[ym(r.observed_at)].append(r)
    m_buckets: dict[str, list[MarineObservation]] = defaultdict(list)
    for r in marine_rows:
        m_buckets[ym(r.observed_at)].append(r)

    headers = [
        "year_month", "avg_temp_c", "max_wind_ms", "total_rain_mm",
        "rain_days", "avg_wave_h_m", "max_wave_h_m",
    ]
    all_months = sorted(set(w_buckets) | set(m_buckets))
    rows_out: list[list[Any]] = []
    for mo in all_months:
        ws = w_buckets.get(mo, [])
        ms = m_buckets.get(mo, [])
        temps  = [r.temperature_c for r in ws if r.temperature_c is not None]
        winds  = [r.wind_speed_ms for r in ws if r.wind_speed_ms is not None]
        rains  = [r.precip_mm     for r in ws if r.precip_mm     is not None]
        waves  = [r.sig_wave_h_m  for r in ms if r.sig_wave_h_m  is not None]
        rows_out.append([
            mo,
            round(float(np.mean(temps)), 3) if temps else None,
            round(float(np.max(winds)),  3) if winds else None,
            round(float(sum(rains)),     3) if rains else None,
            sum(1 for r in rains if r > 0) if rains else None,
            round(float(np.mean(waves)), 3) if waves else None,
            round(float(np.max(waves)),  3) if waves else None,
        ])
    return headers, rows_out


def _build_decision(audit_rows: list[AuditLog]) -> tuple[list[str], list[list[Any]]]:
    headers = ["occurred_at", "actor", "action", "target_id", "detail"]
    rows_out: list[list[Any]] = []
    for r in audit_rows:
        rows_out.append([
            _isoformat(r.occurred_at),
            r.actor,
            r.action,
            r.target_id,
            str(r.detail) if r.detail else None,
        ])
    return headers, rows_out


def _build_marine(marine_rows: list[MarineObservation]) -> tuple[list[str], list[list[Any]]]:
    headers = [
        "observed_at", "sig_wave_h_m", "wave_period_s", "wave_dir_deg",
        "tide_level_m", "current_speed_ms", "current_dir_deg",
    ]
    rows_out: list[list[Any]] = []
    for r in marine_rows:
        rows_out.append([
            _isoformat(r.observed_at),
            r.sig_wave_h_m, r.wave_period_s, r.wave_dir_deg,
            r.tide_level_m, r.current_speed_ms, r.current_dir_deg,
        ])
    return headers, rows_out


def _build_annual(
    weather_rows: list[WeatherObservation],
    marine_rows: list[MarineObservation],
) -> tuple[list[str], list[list[Any]]]:
    from collections import defaultdict
    import numpy as np

    w_buckets: dict[int, list[WeatherObservation]] = defaultdict(list)
    for r in weather_rows:
        w_buckets[r.observed_at.year].append(r)
    m_buckets: dict[int, list[MarineObservation]] = defaultdict(list)
    for r in marine_rows:
        m_buckets[r.observed_at.year].append(r)

    headers = [
        "year", "avg_temp_c", "max_wind_ms", "total_rain_mm",
        "rain_days", "avg_wave_h_m", "max_wave_h_m",
    ]
    all_years = sorted(set(w_buckets) | set(m_buckets))
    rows_out: list[list[Any]] = []
    for yr in all_years:
        ws = w_buckets.get(yr, [])
        ms = m_buckets.get(yr, [])
        temps  = [r.temperature_c for r in ws if r.temperature_c is not None]
        winds  = [r.wind_speed_ms for r in ws if r.wind_speed_ms is not None]
        rains  = [r.precip_mm     for r in ws if r.precip_mm     is not None]
        waves  = [r.sig_wave_h_m  for r in ms if r.sig_wave_h_m  is not None]
        rows_out.append([
            yr,
            round(float(np.mean(temps)), 3) if temps else None,
            round(float(np.max(winds)),  3) if winds else None,
            round(float(sum(rains)),     3) if rains else None,
            sum(1 for r in rains if r > 0) if rains else None,
            round(float(np.mean(waves)), 3) if waves else None,
            round(float(np.max(waves)),  3) if waves else None,
        ])
    return headers, rows_out


# ---------------------------------------------------------------------------
# File serializers
# ---------------------------------------------------------------------------

def _to_csv(headers: list[str], rows: list[list[Any]]) -> io.StringIO:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    buf.seek(0)
    return buf


def _to_excel(headers: list[str], rows: list[list[Any]]) -> io.BytesIO:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ---------------------------------------------------------------------------
# POST /reports
# ---------------------------------------------------------------------------

@router.post("/reports")
async def generate_report(
    req: ReportRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """レポート生成エンドポイント。

    指定テンプレートと期間のデータを CSV または Excel で返す。
    openpyxl が利用できない場合は CSV にフォールバックする。
    """
    t0 = _parse_date(req.date_from, end_of_day=False)
    t1 = _parse_date(req.date_to,   end_of_day=True)

    if t0 > t1:
        raise HTTPException(status_code=422, detail="date_from は date_to 以前である必要があります")

    # Fetch base data
    w_rows: list[WeatherObservation] = []
    m_rows: list[MarineObservation] = []
    audit_rows: list[AuditLog] = []

    if req.template != "decision":
        w_stmt = (
            select(WeatherObservation)
            .where(WeatherObservation.site_id == req.site_id)
            .where(WeatherObservation.observed_at.between(t0, t1))
            .order_by(WeatherObservation.observed_at)
        )
        w_rows = (await db.execute(w_stmt)).scalars().all()

    if req.template in ("daily", "weekly", "monthly", "marine", "annual"):
        m_stmt = (
            select(MarineObservation)
            .where(MarineObservation.site_id == req.site_id)
            .where(MarineObservation.observed_at.between(t0, t1))
            .order_by(MarineObservation.observed_at)
        )
        m_rows = (await db.execute(m_stmt)).scalars().all()

    if req.template == "decision":
        a_stmt = (
            select(AuditLog)
            .where(AuditLog.action.like("decision.%"))
            .where(AuditLog.occurred_at.between(t0, t1))
            .order_by(AuditLog.occurred_at)
        )
        audit_rows = (await db.execute(a_stmt)).scalars().all()

    # Build table
    if req.template == "daily":
        headers, rows = _build_daily(w_rows, m_rows)
    elif req.template == "weekly":
        headers, rows = _build_weekly(w_rows, m_rows)
    elif req.template == "monthly":
        headers, rows = _build_monthly(w_rows, m_rows)
    elif req.template == "decision":
        headers, rows = _build_decision(audit_rows)
    elif req.template == "marine":
        headers, rows = _build_marine(m_rows)
    else:  # annual
        headers, rows = _build_annual(w_rows, m_rows)

    # Serialize
    effective_format = req.format
    if effective_format == "excel" and not _OPENPYXL_AVAILABLE:
        effective_format = "csv"   # graceful fallback

    site_slug = str(req.site_id)[:8]
    if effective_format == "csv":
        buf = _to_csv(headers, rows)
        filename = f"report_{req.template}_{site_slug}.csv"
        return StreamingResponse(
            buf,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:
        buf = _to_excel(headers, rows)
        filename = f"report_{req.template}_{site_slug}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
