"""Unit tests for /sites endpoints — no DB required."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.sites import router
from app.db.session import get_db
from app.models.site import Site


_NOW = datetime(2026, 5, 27, 9, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake DB helpers
# ---------------------------------------------------------------------------

class _FakeResult:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def scalar_one_or_none(self):
        return self._scalar


class _FakeDB:
    def __init__(self, execute_return=None):
        self._execute_return = execute_return or _FakeResult()

    async def execute(self, stmt):
        return self._execute_return

    def add(self, obj):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = _NOW
        if getattr(obj, "updated_at", None) is None:
            obj.updated_at = _NOW

    async def delete(self, obj):
        pass


def _make_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def _override():
        yield fake_db

    app.dependency_overrides[get_db] = _override
    return app


# ---------------------------------------------------------------------------
# Fake model factory
# ---------------------------------------------------------------------------

SITE_ID = uuid.uuid4()


def _fake_site() -> Site:
    s = Site()
    s.id = SITE_ID
    s.code = "SITE01"
    s.name = "テスト現場"
    s.kind = "land"
    s.lat = 35.6812
    s.lon = 139.7671
    s.jma_station_id = None
    s.wave_grid_lat = None
    s.wave_grid_lon = None
    s.address = None
    s.note = None
    s.created_at = _NOW
    s.updated_at = _NOW
    return s


# ---------------------------------------------------------------------------
# GET /sites
# ---------------------------------------------------------------------------

def test_list_sites_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get("/sites")
    assert r.status_code == 200
    assert r.json() == []


def test_list_sites_returns_row():
    site = _fake_site()
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[site]))))
    r = c.get("/sites")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["code"] == "SITE01"
    assert r.json()[0]["kind"] == "land"


# ---------------------------------------------------------------------------
# GET /sites/{site_id}
# ---------------------------------------------------------------------------

def test_get_site_404_when_not_found():
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    r = c.get(f"/sites/{SITE_ID}")
    assert r.status_code == 404


def test_get_site_200_when_found():
    site = _fake_site()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=site))))
    r = c.get(f"/sites/{SITE_ID}")
    assert r.status_code == 200
    assert r.json()["code"] == "SITE01"


# ---------------------------------------------------------------------------
# POST /sites
# ---------------------------------------------------------------------------

def test_create_site_409_when_duplicate():
    """POST with a code that already exists returns 409."""
    existing = _fake_site()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=existing))))
    payload = {
        "code": "SITE01",
        "name": "重複現場",
        "kind": "land",
        "lat": 35.0,
        "lon": 139.0,
    }
    r = c.post("/sites", json=payload)
    assert r.status_code == 409


def test_create_site_201_new_code():
    """POST with a new code succeeds and returns 201."""
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    payload = {
        "code": "SITE02",
        "name": "新規現場",
        "kind": "marine",
        "lat": 34.0,
        "lon": 138.0,
    }
    r = c.post("/sites", json=payload)
    assert r.status_code == 201
    assert r.json()["code"] == "SITE02"
    assert r.json()["kind"] == "marine"
