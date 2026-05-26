"""JMA AMeDAS fetcher.

Pure I/O layer: given a station_id, fetch the latest 10-minute observation block
and normalise to the shape `WeatherObservationIn` accepts. No DB writes here.

JMA endpoint shape (public, no auth):
  https://www.jma.go.jp/bosai/amedas/data/point/{station}/{YYYYMMDD}_{H}.json
where H is one of "00","03","06","09","12","15","18","21" (JST, 3h blocks).

The response is a dict keyed by observation time `YYYYMMDDHHMM` (JST). Each
entry holds tuples `[value, quality_flag]` for fields like `temp`, `humidity`,
`pressure`, `precipitation10m`, `wind`, `windDirection`, `sun10m`.
quality_flag == 0 means valid; non-zero means missing/suspect.
"""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")
JMA_BASE = "https://www.jma.go.jp/bosai/amedas/data/point"

# JMA wind-direction integers (0..16, where 0 = calm) → degrees (None for calm).
_WIND_DIR_DEG = {
    0: None, 1: 22.5, 2: 45.0, 3: 67.5, 4: 90.0, 5: 112.5, 6: 135.0, 7: 157.5,
    8: 180.0, 9: 202.5, 10: 225.0, 11: 247.5, 12: 270.0, 13: 292.5, 14: 315.0,
    15: 337.5, 16: 0.0,
}


def _val(entry: dict, key: str) -> float | None:
    """Extract a numeric value if its quality flag is 0 (valid)."""
    v = entry.get(key)
    if not isinstance(v, list) or len(v) < 2:
        return None
    raw, flag = v[0], v[1]
    if flag != 0 or raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _wind_dir_deg(entry: dict) -> float | None:
    v = entry.get("windDirection")
    if not isinstance(v, list) or len(v) < 2 or v[1] != 0:
        return None
    try:
        return _WIND_DIR_DEG.get(int(v[0]))
    except (TypeError, ValueError):
        return None


def _block_url(station_id: str, now_jst: datetime) -> str:
    # JMA chunks every 3h. Floor the JST hour to {00,03,06,09,12,15,18,21}.
    h = (now_jst.hour // 3) * 3
    return f"{JMA_BASE}/{station_id}/{now_jst.strftime('%Y%m%d')}_{h:02d}.json"


def _latest_entry(payload: dict[str, Any]) -> tuple[datetime, dict[str, Any]] | None:
    if not payload:
        return None
    # Keys are JST stamps. Historically "YYYYMMDDHHMM" (12), but the live feed
    # now emits "YYYYMMDDHHMMSS" (14, seconds always "00"). Accept both.
    latest_key = max(payload.keys())
    entry = payload[latest_key]
    if not isinstance(entry, dict):
        return None
    fmt = "%Y%m%d%H%M%S" if len(latest_key) == 14 else "%Y%m%d%H%M"
    observed_jst = datetime.strptime(latest_key, fmt).replace(tzinfo=JST)
    return observed_jst.astimezone(timezone.utc), entry


def normalise(entry: dict[str, Any], observed_at: datetime, site_id: str,
              *, source: str = "jma", data_version: int = 1) -> dict[str, Any]:
    """Map a JMA AMeDAS entry to a WeatherObservationIn-shaped dict."""
    precip = _val(entry, "precipitation10m")
    sun_sec = _val(entry, "sun10m")  # seconds of sunshine in the 10-min window
    return {
        "site_id": site_id,
        "observed_at": observed_at,
        "temperature_c": _val(entry, "temp"),
        "humidity_pct":  _val(entry, "humidity"),
        "pressure_hpa":  _val(entry, "pressure"),
        "precip_mm":     precip,
        "wind_speed_ms": _val(entry, "wind"),
        "wind_gust_ms":  _val(entry, "windGust"),
        "wind_dir_deg":  _wind_dir_deg(entry),
        # AMeDAS reports seconds in a 10-min window; convert to hours.
        "sunshine_h":    (sun_sec / 3600.0) if sun_sec is not None else None,
        "data_version":  data_version,
        "source":        source,
    }


async def fetch_latest(
    client: httpx.AsyncClient,
    station_id: str,
    *,
    now: datetime | None = None,
) -> tuple[datetime, dict[str, Any]] | None:
    """Fetch latest AMeDAS observation. Falls back to the previous 3h block if
    the current block is empty (which happens right after a block rollover).
    """
    now_jst = (now or datetime.now(timezone.utc)).astimezone(JST)
    for offset in (0, -3):  # try current then previous block
        ts = now_jst + timedelta(hours=offset)
        url = _block_url(station_id, ts)
        try:
            r = await client.get(url, timeout=10.0)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            payload = r.json()
        except httpx.HTTPError as exc:
            log.warning("jma fetch failed station=%s url=%s: %s", station_id, url, exc)
            continue
        latest = _latest_entry(payload)
        if latest:
            return latest
    return None
