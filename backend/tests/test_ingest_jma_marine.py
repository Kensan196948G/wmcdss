"""Unit tests for app.jobs.ingest_jma_marine.run_once — no DB, no network required."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.exc import SQLAlchemyError

import app.jobs.ingest_jma_marine as ingest_marine
from app.models.site import Site

_NOW = datetime(2026, 5, 27, 9, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake DB helpers (same pattern as test_ingest_jma)
# ---------------------------------------------------------------------------

class _FakeBeginNested:
    async def __aenter__(self): return self
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False


class _FakeSession:
    def __init__(self, site_rows=None, upsert_raises=None, commit_raises=None):
        self._site_rows = site_rows or []
        self._upsert_raises = upsert_raises
        self._commit_raises = commit_raises
        self._execute_count = 0
        self.committed = False
        self.rolled_back = False
        self.added = []
        self.flushed = 0

    async def execute(self, stmt):
        self._execute_count += 1
        if self._execute_count == 1:
            return _FakeResult(self._site_rows)
        if self._upsert_raises:
            raise self._upsert_raises
        return _FakeResult()

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushed += 1

    async def commit(self):
        if self._commit_raises:
            raise self._commit_raises
        self.committed = True

    async def rollback(self):
        self.rolled_back = True

    def begin_nested(self):
        return _FakeBeginNested()


class _FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []
    def scalars(self): return self
    def all(self): return self._rows


class _FakeSessionCM:
    def __init__(self, db): self._db = db
    async def __aenter__(self): return self._db
    async def __aexit__(self, *_): pass


# ---------------------------------------------------------------------------
# Fake model factory
# ---------------------------------------------------------------------------

def _fake_marine_site(lat: float = 35.0, lon: float = 139.0) -> Site:
    s = Site()
    s.id = uuid.uuid4()
    s.code = "MARINE-01"
    s.name = "Marine Test Site"
    s.kind = "marine"
    s.lat = lat
    s.lon = lon
    s.wave_grid_lat = lat
    s.wave_grid_lon = lon
    s.jma_station_id = None
    return s


_FETCH_RESULT = (_NOW, {"sigWaveHeight": [1.5, 0], "wavePeriod": [8.0, 0]})

_NORMALISED = {
    "site_id": "00000000-0000-0000-0000-000000000001",
    "observed_at": _NOW,
    "sig_wave_h_m": 1.5,
    "wave_period_s": 8.0,
    "wave_dir_deg": None,
    "tide_level_m": None,
    "current_speed_ms": None,
    "current_dir_deg": None,
    "data_version": 1,
    "source": "open_meteo_marine_info",
}


# ---------------------------------------------------------------------------
# Tests — run_once()
# ---------------------------------------------------------------------------

async def test_marine_run_once_audits_when_no_sites():
    """Marine job audits even when no marine sites (distinct from weather job).

    This contract is critical: "no marine sites configured" is distinguishable
    from "ingester never ran" only if the audit row exists.
    """
    db = _FakeSession(site_rows=[])
    with patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)):
        n = await ingest_marine.run_once()
    assert n == 0
    assert db.committed is True  # audit committed even with no sites
    assert len(db.added) == 1  # AuditLog added
    audit_row = db.added[0]
    assert audit_row.action == "observation.marine.ingest"
    assert audit_row.detail["sites_total"] == 0


async def test_marine_run_once_writes_row_successfully():
    """Single marine site, successful fetch + upsert → written=1, audit committed."""
    db = _FakeSession(site_rows=[_fake_marine_site()])
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma_marine.marine_svc.normalise", return_value=_NORMALISED),
    ):
        n = await ingest_marine.run_once()
    assert n == 1
    assert db.committed is True
    assert len(db.added) == 1
    audit_row = db.added[0]
    assert audit_row.detail["written"] == 1


async def test_marine_run_once_skips_transient_timeout():
    """TimeoutException (transient) → fetch_failed incremented, audit committed."""
    db = _FakeSession(site_rows=[_fake_marine_site()])
    exc = httpx.TimeoutException("timeout", request=MagicMock())
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_marine.run_once()
    assert n == 0
    assert db.committed is True


async def test_marine_run_once_skips_4xx_upstream():
    """HTTPStatusError(4xx) → upstream_4xx incremented, continues."""
    db = _FakeSession(site_rows=[_fake_marine_site()])
    resp = MagicMock()
    resp.status_code = 429
    exc = httpx.HTTPStatusError("429 Too Many Requests", request=MagicMock(), response=resp)
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_marine.run_once()
    assert n == 0


async def test_marine_run_once_skips_5xx_upstream():
    """HTTPStatusError(5xx) → upstream_5xx incremented, continues."""
    db = _FakeSession(site_rows=[_fake_marine_site()])
    resp = MagicMock()
    resp.status_code = 500
    exc = httpx.HTTPStatusError("500 Internal Server Error", request=MagicMock(), response=resp)
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_marine.run_once()
    assert n == 0
    assert db.committed is True


async def test_marine_run_once_skips_no_data():
    """fetch_latest returns None → no_data incremented, audit committed."""
    db = _FakeSession(site_rows=[_fake_marine_site()])
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(return_value=None)),
    ):
        n = await ingest_marine.run_once()
    assert n == 0
    assert db.committed is True


async def test_marine_run_once_skips_upsert_failure():
    """SQLAlchemyError in SAVEPOINT → upsert_failed incremented, job continues."""
    db = _FakeSession(
        site_rows=[_fake_marine_site(35.0, 139.0), _fake_marine_site(34.0, 138.0)],
        upsert_raises=SQLAlchemyError("check constraint"),
    )
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma_marine.marine_svc.normalise", return_value=_NORMALISED),
    ):
        n = await ingest_marine.run_once()
    assert n == 0
    assert db.committed is True


async def test_marine_run_once_raises_when_commit_fails():
    """db.commit() failure → SQLAlchemyError propagates, rollback called."""
    db = _FakeSession(
        site_rows=[_fake_marine_site()],
        commit_raises=SQLAlchemyError("commit failed"),
    )
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma_marine.marine_svc.normalise", return_value=_NORMALISED),
    ):
        with pytest.raises(SQLAlchemyError):
            await ingest_marine.run_once()
    assert db.rolled_back is True


async def test_marine_run_once_audit_detail_shape():
    """Audit detail includes all expected counter fields."""
    db = _FakeSession(site_rows=[_fake_marine_site()])
    with (
        patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma_marine.marine_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma_marine.marine_svc.normalise", return_value=_NORMALISED),
    ):
        await ingest_marine.run_once()
    detail = db.added[0].detail
    assert set(detail.keys()) >= {
        "written", "fetch_failed", "upsert_failed", "no_data",
        "upstream_4xx", "upstream_5xx", "sites_total", "source",
    }
    assert detail["source"] == "open_meteo_marine_info"
    assert detail["usage"] == "information_sharing_only"


async def test_marine_no_sites_commit_failure_raises():
    """Marine no-sites path: audit commit failure → SQLAlchemyError propagates."""
    db = _FakeSession(
        site_rows=[],
        commit_raises=SQLAlchemyError("no-sites audit commit failed"),
    )
    with patch("app.jobs.ingest_jma_marine.SessionLocal", return_value=_FakeSessionCM(db)):
        with pytest.raises(SQLAlchemyError):
            await ingest_marine.run_once()
    assert db.rolled_back is True


# ---------------------------------------------------------------------------
# Loop 55 — main() entry-point coverage (sync tests, asyncio.run mocked)
# ---------------------------------------------------------------------------


def test_marine_main_returns_0_on_success():
    # main() wraps asyncio.run(run_once()). Patch to bypass event loop.
    with patch("asyncio.run", return_value=1):
        result = ingest_marine.main()
    assert result == 0


def test_marine_main_returns_1_on_exception():
    # Crash in run_once() → main() catches, logs, returns 1.
    with patch("asyncio.run", side_effect=Exception("marine run_once crashed")):
        result = ingest_marine.main()
    assert result == 1
