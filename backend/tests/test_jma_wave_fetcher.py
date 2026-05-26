"""Unit tests for app.services.jma_wave — mocked via httpx MockTransport.

Mirrors test_jma_fetcher.py in structure so an operator who knows one test
suite can read the other. The cases here pin the *contract we expect from
JMA's wave nowcast*; they will fail loudly if the upstream schema drifts
during the OPERATOR TODO confirmation in Month 5.
"""
from __future__ import annotations
from datetime import datetime, timezone

import httpx
import pytest

from app.services import jma_wave


def _sample_payload(stamp_jst: str = "202605261200") -> dict:
    return {
        stamp_jst: {
            "sigWaveHeight":    [1.4, 0],
            "wavePeriod":       [6.2, 0],
            "waveDirection":    [135.0, 0],
            "tideLevel":        [0.42, 0],
            "currentSpeed":     [0.3, 0],
            "currentDirection": [210.0, 0],
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
        result = await jma_wave.fetch_latest(
            client, 35.62, 139.77,
            now=datetime(2026, 5, 26, 3, 35, tzinfo=timezone.utc),  # 12:35 JST
        )
    assert result is not None
    observed_at, entry = result
    # 12:00 JST → 03:00 UTC
    assert observed_at == datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc)
    assert entry["sigWaveHeight"] == [1.4, 0]


async def test_fetch_latest_falls_back_to_yesterday(mock_client_factory):
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        calls.append(url)
        # Today's file empty → must fall back to yesterday.
        if "20260526" in url:
            return httpx.Response(200, json={})
        return httpx.Response(200, json=_sample_payload("202605252350"))

    async with mock_client_factory(handler) as client:
        result = await jma_wave.fetch_latest(
            client, 35.0, 140.0,
            now=datetime(2026, 5, 26, 0, 5, tzinfo=timezone.utc),  # 09:05 JST
        )
    assert len(calls) == 2
    assert result is not None
    observed_at, _ = result
    # 23:50 JST 25th → 14:50 UTC 25th
    assert observed_at == datetime(2026, 5, 25, 14, 50, tzinfo=timezone.utc)


async def test_fetch_latest_returns_none_when_both_404(mock_client_factory):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async with mock_client_factory(handler) as client:
        result = await jma_wave.fetch_latest(client, 35.0, 140.0)
    assert result is None


async def test_fetch_latest_raises_on_5xx(mock_client_factory):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    async with mock_client_factory(handler) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await jma_wave.fetch_latest(client, 35.0, 140.0)


def test_normalise_skips_bad_quality_flags():
    entry = {
        "sigWaveHeight":    [1.2, 0],
        "wavePeriod":       [5.5, 1],   # bad flag → drop
        "waveDirection":    [90.0, 0],
        "tideLevel":        [None, 0],
        "currentSpeed":     [0.2, 0],
        "currentDirection": [180.0, 0],
    }
    out = jma_wave.normalise(
        entry,
        observed_at=datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc),
        site_id="00000000-0000-0000-0000-000000000001",
    )
    assert out["sig_wave_h_m"] == 1.2
    assert out["wave_period_s"] is None      # filtered out by qc=1
    assert out["wave_dir_deg"] == 90.0
    assert out["tide_level_m"] is None       # explicit None
    assert out["current_speed_ms"] == 0.2
    assert out["current_dir_deg"] == 180.0
    assert out["source"] == "jma_wave"


def test_normalise_filters_missing_value_sentinels():
    # JMA uses -9999 / 9999 as missing-data sentinels — must not leak into DB.
    entry = {
        "sigWaveHeight": [-9999.0, 0],
        "wavePeriod":     [9999.0, 0],
        "waveDirection":  [45.0, 0],
    }
    out = jma_wave.normalise(
        entry,
        observed_at=datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc),
        site_id="00000000-0000-0000-0000-000000000001",
    )
    assert out["sig_wave_h_m"] is None
    assert out["wave_period_s"] is None
    assert out["wave_dir_deg"] == 45.0


def test_normalise_accepts_scalar_format():
    # Some JMA endpoints emit plain scalars (no [value, qc] tuple). Both
    # shapes must round-trip identically.
    entry = {
        "sigWaveHeight":    1.7,
        "wavePeriod":       7.0,
        "waveDirection":    180.0,
    }
    out = jma_wave.normalise(
        entry,
        observed_at=datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc),
        site_id="00000000-0000-0000-0000-000000000001",
    )
    assert out["sig_wave_h_m"] == 1.7
    assert out["wave_period_s"] == 7.0
    assert out["wave_dir_deg"] == 180.0


async def test_fetch_latest_accepts_14char_timestamps(mock_client_factory):
    # If JMA appends ":00" seconds, key length is 14 — must still parse.
    payload = {"20260526120000": {"sigWaveHeight": [1.0, 0]}}

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    async with mock_client_factory(handler) as client:
        result = await jma_wave.fetch_latest(
            client, 35.0, 140.0,
            now=datetime(2026, 5, 26, 3, 35, tzinfo=timezone.utc),
        )
    assert result is not None
    observed_at, _ = result
    assert observed_at == datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc)


def test_snap_to_grid_rounds_to_nearest_005():
    assert jma_wave._snap_to_grid(35.6231) == pytest.approx(35.60)
    assert jma_wave._snap_to_grid(139.7714) == pytest.approx(139.75)
    assert jma_wave._snap_to_grid(35.625) == pytest.approx(35.60) or \
           jma_wave._snap_to_grid(35.625) == pytest.approx(35.65)  # banker's rounding tolerance


# ---------------------------------------------------------------------------
# Error-propagation contract for fetch_latest (jma_wave.py:156-167).
#
# Horizontal mirror of test_jma_fetcher.py's Loop 42 block. The wave fetcher
# documents the *same* policy as the AMeDAS fetcher in its docstring (404 →
# fall through to yesterday; everything else raises), but only the 5xx arm
# was previously pinned. 429/401/timeout/connect-error/empty-payload were
# silently relying on jma.py's tests by analogy — that link breaks the
# moment one module's policy diverges, so we pin wave explicitly here.
# ---------------------------------------------------------------------------

async def test_fetch_latest_raises_on_429(mock_client_factory):
    # Same shape as 5xx (raise_for_status), but distinct operational meaning:
    # JMA throttles aggressive polling and we MUST surface that to the
    # scheduler so it can back off — not silently fall through to "yesterday".
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    async with mock_client_factory(handler) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await jma_wave.fetch_latest(client, 35.0, 140.0)


async def test_fetch_latest_raises_on_401(mock_client_factory):
    # Wave nowcast is currently open, but the docstring's "OPERATOR TODO
    # Month 5" leaves room for a future auth-required endpoint. Pin 401 now
    # so that migration cannot silently degrade to "missing data".
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    async with mock_client_factory(handler) as client:
        with pytest.raises(httpx.HTTPStatusError):
            await jma_wave.fetch_latest(client, 35.0, 140.0)


async def test_fetch_latest_propagates_timeout(mock_client_factory):
    # client.get(..., timeout=10.0) — a hung JMA edge surfaces as ReadTimeout.
    # MUST NOT be swallowed into the (0,-1) fallback; caller decides retry.
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("simulated read timeout", request=req)

    async with mock_client_factory(handler) as client:
        with pytest.raises(httpx.TimeoutException):
            await jma_wave.fetch_latest(client, 35.0, 140.0)


async def test_fetch_latest_propagates_connect_error(mock_client_factory):
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated network failure", request=req)

    async with mock_client_factory(handler) as client:
        with pytest.raises(httpx.ConnectError):
            await jma_wave.fetch_latest(client, 35.0, 140.0)


async def test_fetch_latest_returns_none_when_both_blocks_empty_payload(mock_client_factory):
    # Distinct from the 404 path above: 200 + {} means JMA has the file
    # for this grid cell but no observations are published yet (the gap
    # right after midnight JST before the first hourly tick). The (0,-1)
    # loop must exhaust through *both* days and return None — not the
    # empty {} from today.
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(str(req.url))
        return httpx.Response(200, json={})

    async with mock_client_factory(handler) as client:
        result = await jma_wave.fetch_latest(
            client, 35.0, 140.0,
            now=datetime(2026, 5, 26, 0, 5, tzinfo=timezone.utc),  # 09:05 JST
        )
    assert result is None
    assert len(calls) == 2  # both today and yesterday were attempted
