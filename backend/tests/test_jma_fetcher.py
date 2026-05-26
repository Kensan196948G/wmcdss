"""Unit tests for app.services.jma — pure I/O layer mocked via httpx MockTransport."""
from __future__ import annotations
from datetime import datetime, timezone

import httpx
import pytest

from app.services import jma


def _sample_payload(stamp_jst: str = "202605261230") -> dict:
    return {
        stamp_jst: {
            "temp": [22.4, 0],
            "humidity": [58, 0],
            "pressure": [1013.2, 0],
            "precipitation10m": [0.0, 0],
            "wind": [3.5, 0],
            "windDirection": [4, 0],   # 90° (east)
            "sun10m": [300, 0],         # 5 minutes of sun in the 10-min window
        }
    }


@pytest.fixture
def mock_client_factory():
    def _make(handler):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return _make


async def test_fetch_latest_parses_payload(mock_client_factory):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_sample_payload())

    async with mock_client_factory(handler) as client:
        result = await jma.fetch_latest(
            client, "44132",
            now=datetime(2026, 5, 26, 3, 35, tzinfo=timezone.utc),  # 12:35 JST
        )
    assert result is not None
    observed_at, entry = result
    assert observed_at == datetime(2026, 5, 26, 3, 30, tzinfo=timezone.utc)
    assert entry["temp"] == [22.4, 0]


async def test_fetch_latest_falls_back_to_previous_block(mock_client_factory):
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(str(req.url))
        # First call (current block) returns empty → must try previous.
        if "_12.json" in str(req.url):
            return httpx.Response(200, json={})
        return httpx.Response(200, json=_sample_payload("202605260955"))

    async with mock_client_factory(handler) as client:
        result = await jma.fetch_latest(
            client, "44132",
            now=datetime(2026, 5, 26, 3, 5, tzinfo=timezone.utc),  # 12:05 JST
        )
    assert len(calls) == 2
    assert result is not None
    observed_at, _ = result
    # 09:55 JST → 00:55 UTC
    assert observed_at == datetime(2026, 5, 26, 0, 55, tzinfo=timezone.utc)


async def test_fetch_latest_returns_none_when_both_blocks_404(mock_client_factory):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async with mock_client_factory(handler) as client:
        result = await jma.fetch_latest(client, "00000")
    assert result is None


def test_normalise_skips_bad_quality_flags():
    entry = {
        "temp": [22.4, 0],
        "humidity": [99, 1],          # bad flag → drop
        "pressure": [None, 0],
        "precipitation10m": [1.5, 0],
        "wind": [3.0, 0],
        "windDirection": [0, 0],      # calm
        "sun10m": [600, 0],
    }
    out = jma.normalise(
        entry,
        observed_at=datetime(2026, 5, 26, 3, 30, tzinfo=timezone.utc),
        site_id="00000000-0000-0000-0000-000000000001",
    )
    assert out["temperature_c"] == 22.4
    assert out["humidity_pct"] is None         # filtered out
    assert out["pressure_hpa"] is None
    assert out["precip_mm"] == 1.5
    assert out["wind_speed_ms"] == 3.0
    assert out["wind_dir_deg"] is None         # calm → None
    assert out["sunshine_h"] == pytest.approx(600 / 3600.0)


async def test_fetch_latest_accepts_14char_timestamps(mock_client_factory):
    # Live JMA feed appends "00" seconds → key length 14.
    payload = {"20260526123000": {"temp": [20.0, 0]}}

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    async with mock_client_factory(handler) as client:
        result = await jma.fetch_latest(
            client, "44132",
            now=datetime(2026, 5, 26, 3, 35, tzinfo=timezone.utc),
        )
    assert result is not None
    observed_at, _ = result
    assert observed_at == datetime(2026, 5, 26, 3, 30, tzinfo=timezone.utc)


def test_normalise_wind_direction_mapping():
    entry = {"wind": [2.0, 0], "windDirection": [4, 0]}  # 4 → 90°
    out = jma.normalise(
        entry, datetime(2026, 1, 1, tzinfo=timezone.utc),
        site_id="00000000-0000-0000-0000-000000000001",
    )
    assert out["wind_dir_deg"] == 90.0
