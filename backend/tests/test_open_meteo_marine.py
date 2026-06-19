from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest

from app.services import open_meteo_marine


def _payload() -> dict:
    return {
        "current": {
            "time": "2026-06-19T12:00",
            "wave_height": 0.14,
            "wave_direction": 183,
            "wave_period": 5.15,
            "sea_level_height_msl": 0.63,
            "ocean_current_velocity": 0.36,
            "ocean_current_direction": 243,
        }
    }


async def test_fetch_latest_parses_current_payload():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.host == "marine-api.open-meteo.com"
        assert "cell_selection=sea" in str(req.url)
        return httpx.Response(200, json=_payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await open_meteo_marine.fetch_latest(client, 35.645, 139.77)

    assert result is not None
    observed_at, entry = result
    assert observed_at == datetime(2026, 6, 19, 12, 0, tzinfo=timezone.utc)
    assert entry["wave_height"] == 0.14


def test_normalise_marks_source_as_information_only_and_converts_current_speed():
    out = open_meteo_marine.normalise(
        _payload()["current"],
        datetime(2026, 6, 19, 12, 0, tzinfo=timezone.utc),
        "00000000-0000-0000-0000-000000000001",
    )

    assert out["sig_wave_h_m"] == 0.14
    assert out["wave_dir_deg"] == 183.0
    assert out["wave_period_s"] == 5.15
    assert out["tide_level_m"] == 0.63
    assert out["current_speed_ms"] == pytest.approx(0.1)
    assert out["current_dir_deg"] == 243.0
    assert out["source"] == "open_meteo_marine_info"
