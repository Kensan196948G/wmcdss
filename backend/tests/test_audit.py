"""Unit tests for GET /audit endpoint — no DB required."""
from __future__ import annotations
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.audit import router
from app.db.session import get_db
from app.models.audit import AuditLog

_NOW = datetime(2026, 5, 27, 9, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake DB helpers
# ---------------------------------------------------------------------------

class _FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeDB:
    def __init__(self, execute_return=None):
        self._execute_return = execute_return or _FakeResult()

    async def execute(self, stmt):
        return self._execute_return

    def add(self, obj): pass
    async def flush(self): pass
    async def commit(self): pass
    async def refresh(self, obj): pass
    async def delete(self, obj): pass


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

def _fake_log(n: int = 1, actor: str | None = "api-key:test",
              action: str = "site.create") -> list[AuditLog]:
    rows = []
    for i in range(n):
        row = AuditLog()
        row.id = i + 1
        row.occurred_at = _NOW
        row.actor = actor
        row.action = action
        row.target_type = "site"
        row.target_id = f"target-{i}"
        row.detail = {"note": f"row {i}"}
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# GET /audit
# ---------------------------------------------------------------------------

def test_list_audit_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get("/audit")
    assert r.status_code == 200
    assert r.json() == []


def test_list_audit_returns_rows():
    rows = _fake_log(3)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit")
    assert r.status_code == 200
    assert len(r.json()) == 3
    assert r.json()[0]["action"] == "site.create"


def test_list_audit_actor_field_present():
    rows = _fake_log(1, actor="api-key:admin")
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit")
    assert r.status_code == 200
    assert r.json()[0]["actor"] == "api-key:admin"


def test_list_audit_with_actor_query_accepted():
    """actor= filter query param is accepted (filter applied in SQL)."""
    rows = _fake_log(1, actor="api-key:filtered", action="threshold.create")
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit?actor=api-key:filtered")
    assert r.status_code == 200
    assert r.json()[0]["actor"] == "api-key:filtered"


def test_list_audit_with_action_query_accepted():
    rows = _fake_log(2, action="decision.create")
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit?action=decision.create")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_list_audit_with_limit_query_accepted():
    rows = _fake_log(5)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit?limit=5")
    assert r.status_code == 200
    assert len(r.json()) == 5


def test_list_audit_null_actor_allowed():
    rows = _fake_log(1, actor=None)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit")
    assert r.status_code == 200
    assert r.json()[0]["actor"] is None


def test_list_audit_detail_field_present():
    rows = _fake_log(1)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit")
    assert r.status_code == 200
    assert r.json()[0]["detail"] == {"note": "row 0"}


def test_list_audit_limit_over_1000_returns_422():
    """FastAPI Query(le=1000) rejects limit=1001 with 422 before hitting the DB."""
    c = TestClient(_make_app(_FakeDB()))
    r = c.get("/audit?limit=1001")
    assert r.status_code == 422


def test_list_audit_with_t0_t1_accepted():
    """t0/t1 datetime params are accepted (SQL range applied in real DB; fake ignores)."""
    rows = _fake_log(1)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit?t0=2026-05-27T00:00:00Z&t1=2026-05-27T23:59:59Z")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_list_audit_target_type_filter_accepted():
    """target_type= query param is accepted (SQL filter applied in real DB; fake ignores)."""
    rows = _fake_log(1)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit?target_type=site")
    assert r.status_code == 200
    assert r.json()[0]["target_type"] == "site"


def test_list_audit_target_id_filter_accepted():
    """target_id= query param is accepted (SQL filter applied in real DB; fake ignores)."""
    rows = _fake_log(1)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit?target_id=target-0")
    assert r.status_code == 200
    assert r.json()[0]["target_id"] == "target-0"


def test_list_audit_row_schema_complete():
    """AuditOut response includes all 7 required fields."""
    rows = _fake_log(1)
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=rows))))
    r = c.get("/audit")
    assert r.status_code == 200
    assert set(r.json()[0].keys()) == {
        "id", "occurred_at", "actor", "action",
        "target_type", "target_id", "detail",
    }
