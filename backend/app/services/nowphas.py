"""NOWPHAS（国土交通省 全国港湾海洋波浪情報網）リアルタイムデータ取得。

公的一次情報（国交省港湾局・各地方整備局）として、全国の港湾・沖合観測局の
有義波高・周期・波向・潮位をリアルタイム XML で取得する。

エンドポイント（2026-08-12 実測・動作確認済み）:
  - 観測局マスタ: /PROG/xml/POINT_SETUP.xml
      <point code="614" ... name="沓形港" lat="45.1872" lon="141.1419" ...>
  - 波浪実況:     /mapxml/{unique}
      <DataMap time20min="202608122300"> <mapdata code="614">
        <yugiha>0.55</yugiha> <shiyuki>4.6</shiyuki> <namimuki>E</namimuki>
        <zentai_wh>60</zentai_wh> <fuha_wh>57</fuha_wh> <uneri_wh>19</uneri_wh>
        ... 値は "99999" で欠測表現
  - 潮位実況:     /choui_mapxml/{unique}
      <DataMap datatime="202608122320"> <mapdata code="614">
        <choui>17</choui> <tenmon>14</tenmon> <hensa>3</hensa>

本モジュールは純粋 I/O 層（parse / normalise）。DB 書き込みは
`app.jobs.ingest_nowphas` が行う。
"""
from __future__ import annotations

import logging
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

log = logging.getLogger(__name__)

SOURCE = "nowphas"
JST = ZoneInfo("Asia/Tokyo")
BASE_URL = "https://nowphas.mlit.go.jp"
POINT_SETUP_URL = f"{BASE_URL}/PROG/xml/POINT_SETUP.xml"
MAP_URL = f"{BASE_URL}/mapxml/1"
TIDE_URL = f"{BASE_URL}/choui_mapxml/1"

# NOWPHAS の欠測表現（防災情報XMLと同じ慣習）
_MISSING = {"99999", ""}

# 16方位（+8方位）→ 度。気象庁の 0..16 コードと混同しないこと。
_COMPASS_TO_DEG = {
    "N": 0.0, "NNE": 22.5, "NE": 45.0, "ENE": 67.5,
    "E": 90.0, "ESE": 112.5, "SE": 135.0, "SSE": 157.5,
    "S": 180.0, "SSW": 202.5, "SW": 225.0, "WSW": 247.5,
    "W": 270.0, "WNW": 292.5, "NW": 315.0, "NNW": 337.5,
}


@dataclass(frozen=True)
class NowphasStation:
    code: str
    name: str
    lat: float
    lon: float


@dataclass(frozen=True)
class NowphasSample:
    observed_at: datetime  # UTC aware
    sig_wave_h_m: float | None
    wave_period_s: float | None
    wave_dir_deg: float | None
    tide_level_m: float | None
    tide_observed_at: datetime | None = None


def _num(value: str | None) -> float | None:
    if value is None:
        return None
    v = value.strip()
    if v in _MISSING:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    # 物理的にありえない値（負値・極端値）も欠測扱い
    return f if math.isfinite(f) else None


def _parse_jst_stamp(raw: str) -> datetime | None:
    """'202608122300' (JST) → UTC aware datetime。"""
    raw = (raw or "").strip()
    if len(raw) < 12:
        return None
    try:
        return datetime.strptime(raw[:12], "%Y%m%d%H%M").replace(tzinfo=JST).astimezone(timezone.utc)
    except ValueError:
        return None


def _compass_to_deg(raw: str | None) -> float | None:
    v = (raw or "").strip().upper()
    return _COMPASS_TO_DEG.get(v)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """2 地点間の距離 (km)。NOWPHAS 観測局の最近傍選定に使用。"""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


async def fetch_stations(client: httpx.AsyncClient) -> list[NowphasStation]:
    """観測局マスタを取得する。失敗時は httpx 例外をそのまま伝播。"""
    resp = await client.get(POINT_SETUP_URL, timeout=15.0)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    stations: list[NowphasStation] = []
    for p in root.iter("point"):
        code = p.get("code")
        name = p.get("name")
        lat = _num(p.get("lat"))
        lon = _num(p.get("lon"))
        if code and name and lat is not None and lon is not None:
            stations.append(NowphasStation(code=code, name=name, lat=lat, lon=lon))
    return stations


def _parse_map_xml(content: bytes) -> tuple[datetime | None, dict[str, dict[str, str]]]:
    root = ET.fromstring(content)
    observed_at = _parse_jst_stamp(root.get("time20min") or "")
    by_code: dict[str, dict[str, str]] = {}
    for md in root.findall("mapdata"):
        code = md.get("code")
        if not code:
            continue
        by_code[code] = {ch.tag: (ch.text or "") for ch in md}
    return observed_at, by_code


def _parse_tide_xml(content: bytes) -> tuple[datetime | None, dict[str, dict[str, str]]]:
    root = ET.fromstring(content)
    observed_at = _parse_jst_stamp(root.get("datatime") or "")
    by_code: dict[str, dict[str, str]] = {}
    for md in root.findall("mapdata"):
        code = md.get("code")
        if not code:
            continue
        by_code[code] = {ch.tag: (ch.text or "") for ch in md}
    return observed_at, by_code


async def fetch_latest(
    client: httpx.AsyncClient,
) -> tuple[datetime | None, dict[str, NowphasSample]]:
    """波浪実況 + 潮位実況を 1 度ずつ取得し、局コードでまとめる。"""
    map_resp = await client.get(MAP_URL, timeout=15.0)
    map_resp.raise_for_status()
    wave_at, wave_map = _parse_map_xml(map_resp.content)

    tide_at: datetime | None = None
    tide_map: dict[str, dict[str, str]] = {}
    try:
        tide_resp = await client.get(TIDE_URL, timeout=15.0)
        if tide_resp.status_code == 200:
            tide_at, tide_map = _parse_tide_xml(tide_resp.content)
    except httpx.HTTPError as exc:
        # 潮位は補助情報。波浪が取れていれば失敗を致命にしない。
        log.warning("nowphas tide fetch failed (wave still usable): %s", exc)

    samples: dict[str, NowphasSample] = {}
    for code, fields in wave_map.items():
        samples[code] = NowphasSample(
            observed_at=wave_at,
            sig_wave_h_m=_num(fields.get("yugiha")),
            wave_period_s=_num(fields.get("shiyuki")),
            wave_dir_deg=_compass_to_deg(fields.get("namimuki")),
            tide_level_m=None,
            tide_observed_at=tide_at,
        )
    for code, fields in tide_map.items():
        if code in samples:
            choui = _num(fields.get("choui"))
            # choui は cm 単位 → m へ変換
            samples[code] = NowphasSample(
                observed_at=samples[code].observed_at,
                sig_wave_h_m=samples[code].sig_wave_h_m,
                wave_period_s=samples[code].wave_period_s,
                wave_dir_deg=samples[code].wave_dir_deg,
                tide_level_m=(choui / 100.0) if choui is not None else None,
                tide_observed_at=tide_at,
            )
    return wave_at, samples


def nearest_station(
    stations: list[NowphasStation],
    lat: float,
    lon: float,
    *,
    max_km: float = 200.0,
) -> NowphasStation | None:
    """現場座標から最も近い観測局を返す（max_km を超えると None）。"""
    best: NowphasStation | None = None
    best_d = max_km
    for st in stations:
        d = haversine_km(lat, lon, st.lat, st.lon)
        if d < best_d:
            best_d = d
            best = st
    return best


def normalise(
    sample: NowphasSample,
    site_id: str,
    *,
    station_code: str,
    data_version: int = 1,
) -> dict[str, Any]:
    """MarineObservation の upsert 行へ変換（source="nowphas"）。"""
    if sample.observed_at is None:
        raise ValueError("NOWPHAS sample has no observed_at")
    return {
        "site_id": site_id,
        "observed_at": sample.observed_at,
        "sig_wave_h_m": sample.sig_wave_h_m,
        "wave_period_s": sample.wave_period_s,
        "wave_dir_deg": sample.wave_dir_deg,
        "tide_level_m": sample.tide_level_m,
        "current_speed_ms": None,
        "current_dir_deg": None,
        "data_version": data_version,
        "source": SOURCE,
        "station_code": station_code,
    }
