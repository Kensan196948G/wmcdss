"""Open-Meteo Marine API fetcher for informational marine sharing.

Open-Meteo marine values are stored with source="open_meteo_marine_info".
They are intentionally treated as reference information, not as construction
decision evidence. The decision API excludes this source explicitly.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

SOURCE = "open_meteo_marine_info"
API_URL = "https://marine-api.open-meteo.com/v1/marine"
CURRENT_VARS = ",".join(
    [
        "wave_height",
        "wave_direction",
        "wave_period",
        "sea_level_height_msl",
        "ocean_current_velocity",
        "ocean_current_direction",
    ]
)


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_time(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def fetch_latest(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
) -> tuple[datetime, dict[str, Any]] | None:
    """Fetch current marine model values for a WGS84 coordinate."""
    resp = await client.get(
        API_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "current": CURRENT_VARS,
            "timezone": "UTC",
            "cell_selection": "sea",
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    payload = resp.json()
    current = payload.get("current")
    if not isinstance(current, dict) or not current.get("time"):
        return None
    return _parse_time(str(current["time"])), current


def normalise(
    entry: dict[str, Any],
    observed_at: datetime,
    site_id: str,
    *,
    source: str = SOURCE,
    data_version: int = 1,
) -> dict[str, Any]:
    """Map Open-Meteo current marine fields to MarineObservation columns."""
    current_kmh = _num(entry.get("ocean_current_velocity"))
    return {
        "site_id": site_id,
        "observed_at": observed_at,
        "sig_wave_h_m": _num(entry.get("wave_height")),
        "wave_period_s": _num(entry.get("wave_period")),
        "wave_dir_deg": _num(entry.get("wave_direction")),
        "tide_level_m": _num(entry.get("sea_level_height_msl")),
        # Open-Meteo currently returns current velocity in km/h for this API.
        "current_speed_ms": current_kmh / 3.6 if current_kmh is not None else None,
        "current_dir_deg": _num(entry.get("ocean_current_direction")),
        "data_version": data_version,
        "source": source,
    }
