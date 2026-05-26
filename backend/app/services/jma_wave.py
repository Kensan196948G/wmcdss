"""JMA coastal wave nowcast fetcher.

Mirrors `app.services.jma` but for marine observations. Kept in a separate
module so AMeDAS-specific quirks (3h block windows, sun10m units, wind-index
mapping) do not bleed into wave parsing — they are genuinely unrelated
upstream contracts.

Pure I/O layer: given (grid_lat, grid_lon), fetch the latest wave nowcast
sample and normalise to `MarineObservationIn` shape. No DB writes here.

JMA endpoint
------------
The wave nowcast is published as gridded JSON. The precise URL contract has
historically changed (`/bosai/wave/...` vs `/bosai/wavecast/...` vs the
GPV/marinedata dump), so the URL template is centralised here as
`WAVE_URL_TEMPLATE`.

    OPERATOR TODO (Month 5 pre-launch): confirm the live URL against
    https://www.jma.go.jp/bosai/ and adjust WAVE_URL_TEMPLATE / the
    response parser before enabling the production timer. The shape we
    parse here matches the "point series" JSON published in 2025-Q4;
    schema drift will surface as `qc_dropped` audit detail.
"""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger(__name__)

JST = ZoneInfo("Asia/Tokyo")

# Grid resolution used when rounding (grid_lat, grid_lon) to the nearest
# JMA wave grid point. JMA wave nowcast is on a 0.05° grid in coastal waters.
_GRID_DEG = 0.05

# URL template uses {lat} / {lon} formatted to one decimal of arc-degree
# (matching JMA's published file naming convention) and {yyyymmdd} for the
# date partition. The exact template is documented above as an
# operator-confirmation TODO.
WAVE_URL_TEMPLATE = (
    "https://www.jma.go.jp/bosai/wave/data/point/"
    "{lat:.2f}_{lon:.2f}/{yyyymmdd}.json"
)


def _snap_to_grid(value: float) -> float:
    """Round to the nearest grid point (defensive: callers may pass raw site
    coords). 35.6231 → 35.60, 139.7714 → 139.75."""
    return round(value / _GRID_DEG) * _GRID_DEG


def _wave_url(grid_lat: float, grid_lon: float, now_jst: datetime) -> str:
    return WAVE_URL_TEMPLATE.format(
        lat=_snap_to_grid(grid_lat),
        lon=_snap_to_grid(grid_lon),
        yyyymmdd=now_jst.strftime("%Y%m%d"),
    )


def _val(entry: dict, key: str, *, dropped: dict[str, str] | None = None) -> float | None:
    """Extract a numeric value, recording QC drops separately from absences.

    The JMA wave payload format varies: some endpoints emit `[value, qc]`
    tuples (same as AMeDAS), others emit plain scalars. Accept both.
    """
    v = entry.get(key)
    if v is None:
        return None
    if isinstance(v, list):
        if len(v) < 2:
            return None
        raw, flag = v[0], v[1]
        if flag != 0:
            if dropped is not None:
                dropped[key] = f"qc={flag}"
            return None
    else:
        raw = v
    if raw is None:
        return None
    try:
        f = float(raw)
    except (TypeError, ValueError):
        return None
    # JMA missing-value sentinels seen in the wild.
    if f in (-9999.0, 9999.0):
        if dropped is not None:
            dropped[key] = "sentinel"
        return None
    return f


def _latest_entry(payload: dict[str, Any]) -> tuple[datetime, dict[str, Any]] | None:
    """Pick the latest timestamp from a {YYYYMMDDHHMM[SS]: {...}} payload."""
    if not payload:
        return None
    latest_key = max(payload.keys())
    entry = payload[latest_key]
    if not isinstance(entry, dict):
        return None
    fmt = "%Y%m%d%H%M%S" if len(latest_key) == 14 else "%Y%m%d%H%M"
    observed_jst = datetime.strptime(latest_key, fmt).replace(tzinfo=JST)
    return observed_jst.astimezone(timezone.utc), entry


def normalise(entry: dict[str, Any], observed_at: datetime, site_id: str,
              *, source: str = "jma_wave", data_version: int = 1,
              grid_lat: float | None = None,
              grid_lon: float | None = None) -> dict[str, Any]:
    """Map a JMA wave entry to a MarineObservationIn-shaped dict."""
    dropped: dict[str, str] = {}
    out = {
        "site_id": site_id,
        "observed_at": observed_at,
        "sig_wave_h_m":     _val(entry, "sigWaveHeight",  dropped=dropped),
        "wave_period_s":    _val(entry, "wavePeriod",     dropped=dropped),
        "wave_dir_deg":     _val(entry, "waveDirection",  dropped=dropped),
        "tide_level_m":     _val(entry, "tideLevel",      dropped=dropped),
        "current_speed_ms": _val(entry, "currentSpeed",   dropped=dropped),
        "current_dir_deg":  _val(entry, "currentDirection", dropped=dropped),
        "data_version":     data_version,
        "source":           source,
    }
    if dropped:
        log.info(
            "jma_wave qc-dropped site=%s grid=%s,%s observed_at=%s fields=%s",
            site_id, grid_lat, grid_lon, observed_at.isoformat(), dropped,
        )
    return out


async def fetch_latest(
    client: httpx.AsyncClient,
    grid_lat: float,
    grid_lon: float,
    *,
    now: datetime | None = None,
) -> tuple[datetime, dict[str, Any]] | None:
    """Fetch latest wave nowcast for the grid cell containing (grid_lat, grid_lon).

    Falls back to yesterday's file if today's is empty (common right after
    midnight JST before the day's first hourly tick).

    Error policy mirrors `app.services.jma.fetch_latest`:
      - 404 on both today and yesterday → return None (site silently has no
        upstream data; surfaced by the job as `no_data` audit counter)
      - 4xx/5xx other than 404 → raise (operator-visible upstream signal)
      - timeout / network → raise
      - JSON decode error on 200 → raise (payload contract change)
    """
    now_jst = (now or datetime.now(timezone.utc)).astimezone(JST)
    for offset_days in (0, -1):
        ts = now_jst + timedelta(days=offset_days)
        url = _wave_url(grid_lat, grid_lon, ts)
        r = await client.get(url, timeout=10.0)
        if r.status_code == 404:
            continue
        r.raise_for_status()
        payload = r.json()
        latest = _latest_entry(payload)
        if latest:
            return latest
    return None
