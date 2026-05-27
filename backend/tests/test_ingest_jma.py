"""Unit tests for app.jobs.ingest_jma.run_once — no DB, no network required."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.exc import SQLAlchemyError

import app.jobs.ingest_jma as ingest_jma
from app.models.site import Site

_NOW = datetime(2026, 5, 27, 9, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake DB helpers
# ---------------------------------------------------------------------------

class _FakeBeginNested:
    """Async context manager for db.begin_nested() — propagates exceptions."""
    async def __aenter__(self): return self
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False  # never suppress


class _FakeSession:
    """Multi-call fake: execute() #1 = site query, #2+ = upsert."""
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
    """Async context manager wrapping _FakeSession."""
    def __init__(self, db): self._db = db
    async def __aenter__(self): return self._db
    async def __aexit__(self, *_): pass


# ---------------------------------------------------------------------------
# Fake model factory
# ---------------------------------------------------------------------------

def _fake_site(station_id: str = "44132") -> Site:
    s = Site()
    s.id = uuid.uuid4()
    s.code = "TEST-01"
    s.name = "Test Site"
    s.kind = "land"
    s.lat = 35.0
    s.lon = 139.0
    s.jma_station_id = station_id
    return s


_FETCH_RESULT = (_NOW, {"temp": [22.4, 0], "wind": [3.5, 0]})

_NORMALISED = {
    "site_id": "00000000-0000-0000-0000-000000000001",
    "observed_at": _NOW,
    "temperature_c": 22.4,
    "humidity_pct": None,
    "pressure_hpa": None,
    "precip_mm": 0.0,
    "wind_speed_ms": 3.5,
    "wind_gust_ms": None,
    "wind_dir_deg": None,
    "sunshine_h": None,
    "data_version": 1,
    "source": "jma",
}


# ---------------------------------------------------------------------------
# Tests — run_once()
# ---------------------------------------------------------------------------

async def test_run_once_returns_0_when_no_sites():
    """No sites with jma_station_id → skip fetch, return 0, no audit."""
    db = _FakeSession(site_rows=[])
    with patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)):
        n = await ingest_jma.run_once()
    assert n == 0
    assert db.committed is False
    assert len(db.added) == 0


async def test_run_once_writes_row_successfully():
    """Single site, successful fetch + upsert → written=1, audit committed."""
    db = _FakeSession(site_rows=[_fake_site()])
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma.jma_svc.normalise", return_value=_NORMALISED),
    ):
        n = await ingest_jma.run_once()
    assert n == 1
    assert db.committed is True
    assert len(db.added) == 1  # AuditLog was added


async def test_run_once_skips_transient_timeout():
    """TimeoutException → fetch_failed incremented, audit still committed, returns 0."""
    db = _FakeSession(site_rows=[_fake_site()])
    exc = httpx.TimeoutException("timeout", request=MagicMock())
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_jma.run_once()
    assert n == 0
    assert db.committed is True  # audit captured even on transient failure


async def test_run_once_skips_4xx_upstream():
    """HTTPStatusError(4xx) → upstream_4xx incremented, fetch_failed incremented."""
    db = _FakeSession(site_rows=[_fake_site()])
    resp = MagicMock()
    resp.status_code = 403
    exc = httpx.HTTPStatusError("403 Forbidden", request=MagicMock(), response=resp)
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_jma.run_once()
    assert n == 0
    assert db.committed is True


async def test_run_once_skips_5xx_upstream():
    """HTTPStatusError(5xx) → upstream_5xx incremented, fetch_failed incremented."""
    db = _FakeSession(site_rows=[_fake_site()])
    resp = MagicMock()
    resp.status_code = 503
    exc = httpx.HTTPStatusError("503 Service Unavailable", request=MagicMock(), response=resp)
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_jma.run_once()
    assert n == 0
    assert db.committed is True


async def test_run_once_skips_no_data():
    """fetch_latest returns None (no observation published) → no_data incremented."""
    db = _FakeSession(site_rows=[_fake_site()])
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(return_value=None)),
    ):
        n = await ingest_jma.run_once()
    assert n == 0
    assert db.committed is True


async def test_run_once_skips_upsert_failure():
    """SQLAlchemyError in upsert SAVEPOINT → upsert_failed incremented, job continues."""
    db = _FakeSession(
        site_rows=[_fake_site("A"), _fake_site("B")],
        upsert_raises=SQLAlchemyError("check constraint"),
    )
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma.jma_svc.normalise", return_value=_NORMALISED),
    ):
        n = await ingest_jma.run_once()
    assert n == 0  # both upserts failed
    assert db.committed is True  # audit still committed despite upsert failures


async def test_run_once_raises_when_commit_fails():
    """db.commit() raises → SQLAlchemyError propagates, rollback called."""
    db = _FakeSession(
        site_rows=[_fake_site()],
        commit_raises=SQLAlchemyError("commit failed"),
    )
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma.jma_svc.normalise", return_value=_NORMALISED),
    ):
        with pytest.raises(SQLAlchemyError):
            await ingest_jma.run_once()
    assert db.rolled_back is True


async def test_run_once_audit_detail_includes_written_count():
    """Audit detail captures written/failed/no_data counters."""
    db = _FakeSession(site_rows=[_fake_site()])
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(return_value=_FETCH_RESULT)),
        patch("app.jobs.ingest_jma.jma_svc.normalise", return_value=_NORMALISED),
    ):
        n = await ingest_jma.run_once()
    assert n == 1
    # AuditLog row was added with expected detail keys
    audit_row = db.added[0]
    assert audit_row.action == "observation.weather.ingest"
    assert audit_row.detail["written"] == 1
    assert audit_row.detail["fetch_failed"] == 0
    assert audit_row.detail["sites_total"] == 1


async def test_run_once_connect_error_is_tolerated():
    """ConnectError (transient) is tolerated — per-site skip, job continues."""
    db = _FakeSession(site_rows=[_fake_site()])
    exc = httpx.ConnectError("connection refused", request=MagicMock())
    with (
        patch("app.jobs.ingest_jma.SessionLocal", return_value=_FakeSessionCM(db)),
        patch("app.jobs.ingest_jma.jma_svc.fetch_latest",
              new=AsyncMock(side_effect=exc)),
    ):
        n = await ingest_jma.run_once()
    assert n == 0
    assert db.committed is True
