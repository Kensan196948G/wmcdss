"""Unit tests for /thresholds CRUD endpoints — no DB required."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.thresholds import router
from app.db.session import get_db
from app.models.threshold import Threshold


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

THRESHOLD_ID = uuid.uuid4()
SITE_ID = uuid.uuid4()


def _fake_threshold() -> Threshold:
    t = Threshold()
    t.id = THRESHOLD_ID
    t.site_id = None
    t.work_type = "concrete"
    t.metric = "precip_mm_1h"
    t.op = ">="
    t.value = 3.0
    t.severity = "warn"
    t.active_from = None
    t.active_to = None
    t.note = None
    t.created_at = _NOW
    t.updated_at = _NOW
    return t


# ---------------------------------------------------------------------------
# GET /thresholds
# ---------------------------------------------------------------------------

def test_list_thresholds_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get("/thresholds")
    assert r.status_code == 200
    assert r.json() == []


def test_list_thresholds_with_site_id_accepted():
    t = _fake_threshold()
    t.site_id = SITE_ID
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[t]))))
    r = c.get(f"/thresholds?site_id={SITE_ID}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["work_type"] == "concrete"


def test_list_thresholds_with_work_type_filter():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get("/thresholds?work_type=marine_lift")
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# GET /thresholds/{threshold_id}
# ---------------------------------------------------------------------------

def test_get_threshold_404_when_not_found():
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    r = c.get(f"/thresholds/{THRESHOLD_ID}")
    assert r.status_code == 404


def test_get_threshold_200_when_found():
    t = _fake_threshold()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=t))))
    r = c.get(f"/thresholds/{THRESHOLD_ID}")
    assert r.status_code == 200
    assert r.json()["metric"] == "precip_mm_1h"
    assert r.json()["severity"] == "warn"


# ---------------------------------------------------------------------------
# POST /thresholds
# ---------------------------------------------------------------------------

def test_create_threshold_201():
    c = TestClient(_make_app(_FakeDB()))
    payload = {
        "work_type": "concrete",
        "metric": "temperature_c",
        "op": "<",
        "value": 4.0,
        "severity": "warn",
    }
    r = c.post("/thresholds", json=payload)
    assert r.status_code == 201
    assert r.json()["metric"] == "temperature_c"


# ---------------------------------------------------------------------------
# PATCH /thresholds/{threshold_id}
# ---------------------------------------------------------------------------

def test_update_threshold_404_when_not_found():
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    r = c.patch(f"/thresholds/{THRESHOLD_ID}", json={"value": 5.0})
    assert r.status_code == 404


def test_update_threshold_200():
    t = _fake_threshold()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=t))))
    r = c.patch(f"/thresholds/{THRESHOLD_ID}", json={"value": 5.0})
    assert r.status_code == 200
    assert r.json()["value"] == 5.0


# ---------------------------------------------------------------------------
# DELETE /thresholds/{threshold_id}
# ---------------------------------------------------------------------------

def test_delete_threshold_404_when_not_found():
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    r = c.delete(f"/thresholds/{THRESHOLD_ID}")
    assert r.status_code == 404


def test_delete_threshold_204():
    t = _fake_threshold()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=t))))
    r = c.delete(f"/thresholds/{THRESHOLD_ID}")
    assert r.status_code == 204
