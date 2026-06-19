"""Boundary-value and error-path tests (Issue #41).

Strengthens the error-case coverage that the existing happy-path suites omit:

  * 422 request validation — missing / invalid / out-of-range fields
  * 401 authorization boundary — write without API key, expired JWT
  * (404 / 409 DB error paths are already covered in test_sites.py /
    test_thresholds.py; this file focuses on the validation + auth gaps.)

Scope notes — these tests assert *real* behavior, not the issue's assumptions:

  * The API has no role-based authorization layer, so there is no "403
    forbidden" path for application users. Write authorization is enforced by
    ``APIKeyMiddleware``, which returns **401** (not 403) when ``X-API-Key`` is
    missing or wrong. We therefore assert the actual 401 boundary.
  * Threshold creation has no uniqueness constraint, so there is no 409 path
    for ``/thresholds`` — only ``/sites`` enforces a unique ``code`` -> 409
    (already covered in test_sites.py).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.auth as api_auth_mod
import app.core.auth as core_auth_mod
from app.api.auth import router as auth_router
from app.api.sites import router as sites_router
from app.api.thresholds import router as thresholds_router
from app.core import config as config_mod
from app.core import security as security_mod
from app.core.config import Settings
from app.core.security import APIKeyMiddleware
from app.db.session import get_db

_NOW = datetime(2026, 6, 19, 9, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Minimal fake DB (mirrors test_sites.py / test_thresholds.py).
# Validation (422) short-circuits before the endpoint body runs, but the
# get_db dependency may still be resolved — override it so no real DB is hit.
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


def _client_with_router(router) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override():
        yield _FakeDB()

    app.dependency_overrides[get_db] = _override
    return TestClient(app)


# ===========================================================================
# /sites — 422 request validation
# ===========================================================================

_VALID_SITE = {
    "code": "SITE01",
    "name": "テスト現場",
    "kind": "land",
    "lat": 35.0,
    "lon": 139.0,
}


def _site_payload(**overrides) -> dict:
    p = dict(_VALID_SITE)
    p.update(overrides)
    return p


def test_create_site_missing_code_returns_422():
    c = _client_with_router(sites_router)
    payload = _site_payload()
    payload.pop("code")
    assert c.post("/sites", json=payload).status_code == 422


def test_create_site_missing_lat_returns_422():
    c = _client_with_router(sites_router)
    payload = _site_payload()
    payload.pop("lat")
    assert c.post("/sites", json=payload).status_code == 422


def test_create_site_lat_above_max_returns_422():
    c = _client_with_router(sites_router)
    assert c.post("/sites", json=_site_payload(lat=90.1)).status_code == 422


def test_create_site_lat_below_min_returns_422():
    c = _client_with_router(sites_router)
    assert c.post("/sites", json=_site_payload(lat=-90.1)).status_code == 422


def test_create_site_lon_above_max_returns_422():
    c = _client_with_router(sites_router)
    assert c.post("/sites", json=_site_payload(lon=180.1)).status_code == 422


def test_create_site_lon_below_min_returns_422():
    c = _client_with_router(sites_router)
    assert c.post("/sites", json=_site_payload(lon=-180.1)).status_code == 422


def test_create_site_invalid_kind_returns_422():
    c = _client_with_router(sites_router)
    assert c.post("/sites", json=_site_payload(kind="air")).status_code == 422


def test_create_site_code_too_long_returns_422():
    c = _client_with_router(sites_router)
    # code Field(max_length=32) — 33 chars must be rejected
    assert c.post("/sites", json=_site_payload(code="X" * 33)).status_code == 422


def test_create_site_at_boundary_values_passes_validation():
    """lat/lon exactly at the inclusive bounds must NOT be rejected (201)."""
    c = _client_with_router(sites_router)
    r = c.post("/sites", json=_site_payload(code="EDGE", lat=90.0, lon=-180.0))
    assert r.status_code == 201


# ===========================================================================
# /thresholds — 422 request validation
# ===========================================================================

_VALID_THRESHOLD = {
    "work_type": "concrete",
    "metric": "precip_mm_1h",
    "op": ">=",
    "value": 3.0,
    "severity": "warn",
}


def _threshold_payload(**overrides) -> dict:
    p = dict(_VALID_THRESHOLD)
    p.update(overrides)
    return p


def test_create_threshold_missing_work_type_returns_422():
    c = _client_with_router(thresholds_router)
    payload = _threshold_payload()
    payload.pop("work_type")
    assert c.post("/thresholds", json=payload).status_code == 422


def test_create_threshold_missing_metric_returns_422():
    c = _client_with_router(thresholds_router)
    payload = _threshold_payload()
    payload.pop("metric")
    assert c.post("/thresholds", json=payload).status_code == 422


def test_create_threshold_missing_value_returns_422():
    c = _client_with_router(thresholds_router)
    payload = _threshold_payload()
    payload.pop("value")
    assert c.post("/thresholds", json=payload).status_code == 422


def test_create_threshold_invalid_op_returns_422():
    c = _client_with_router(thresholds_router)
    # op is Literal["<","<=",">",">=","==","!="] — "~=" is out of range
    assert c.post("/thresholds", json=_threshold_payload(op="~=")).status_code == 422


def test_create_threshold_invalid_severity_returns_422():
    c = _client_with_router(thresholds_router)
    # severity is Literal["warn","stop"] — "critical" is out of range
    assert (
        c.post("/thresholds", json=_threshold_payload(severity="critical")).status_code
        == 422
    )


def test_create_threshold_value_not_a_number_returns_422():
    c = _client_with_router(thresholds_router)
    assert c.post("/thresholds", json=_threshold_payload(value="heavy")).status_code == 422


# ===========================================================================
# Auth — expired JWT must be rejected with 401
# ===========================================================================

# bcrypt hash of 'testpass123' (generated offline — avoid slow hash in CI)
_HASHED = "$2b$12$jh1EnQculq3PRXhpsDiyZeED9HJO2idI.KyjjbESj.BETA0NexhJG"
_LOCAL_USERS = f"admin:{_HASHED}"


def _auth_settings(**overrides) -> Settings:
    defaults: dict = dict(
        api_keys_raw="",
        local_users=_LOCAL_USERS,
        jwt_secret="test-secret-key-32chars-padding!",
        jwt_algorithm="HS256",
        jwt_expire_minutes=60,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _auth_client(monkeypatch, settings: Settings) -> TestClient:
    monkeypatch.setattr(core_auth_mod, "get_settings", lambda: settings)
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: settings)
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


def test_me_with_expired_token_returns_401(monkeypatch):
    """A token whose exp is already in the past must be rejected.

    Issuing with a negative TTL produces an immediately-expired JWT, so the
    same client's /me call exercises the ExpiredSignatureError -> 401 path.
    """
    c = _auth_client(monkeypatch, _auth_settings(jwt_expire_minutes=-1))
    login = c.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "testpass123"}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]

    r = c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_me_with_malformed_authorization_header_returns_401(monkeypatch):
    """A non-JWT bearer value must not crash — it is rejected with 401."""
    c = _auth_client(monkeypatch, _auth_settings())
    r = c.get("/api/v1/auth/me", headers={"Authorization": "Bearer ..."})
    assert r.status_code == 401


# ===========================================================================
# APIKeyMiddleware — write-method authorization boundary (401)
#
# This is the *real* analog of "an unauthorized user performs an operation":
# writes without a valid X-API-Key are blocked with 401, while reads pass.
# Existing tests cover POST; we extend to PATCH/PUT/DELETE and confirm GET
# stays open so the boundary is provably method-scoped.
# ===========================================================================


def _guarded_app(monkeypatch) -> FastAPI:
    fake = config_mod.Settings(api_keys_raw="secret")
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(security_mod, "_config", config_mod)

    app = FastAPI()
    app.add_middleware(APIKeyMiddleware)

    @app.get("/r")
    async def _read():
        return {"ok": True}

    @app.post("/w")
    async def _post():
        return {"ok": True}

    @app.put("/w")
    async def _put():
        return {"ok": True}

    @app.patch("/w")
    async def _patch():
        return {"ok": True}

    @app.delete("/w")
    async def _delete():
        return {"ok": True}

    return app


def test_put_without_key_returns_401(monkeypatch):
    c = TestClient(_guarded_app(monkeypatch))
    assert c.put("/w").status_code == 401


def test_patch_without_key_returns_401(monkeypatch):
    c = TestClient(_guarded_app(monkeypatch))
    assert c.patch("/w").status_code == 401


def test_delete_without_key_returns_401(monkeypatch):
    c = TestClient(_guarded_app(monkeypatch))
    assert c.delete("/w").status_code == 401


def test_write_with_valid_key_passes(monkeypatch):
    c = TestClient(_guarded_app(monkeypatch))
    assert c.put("/w", headers={"X-API-Key": "secret"}).status_code == 200
    assert c.patch("/w", headers={"X-API-Key": "secret"}).status_code == 200
    assert c.delete("/w", headers={"X-API-Key": "secret"}).status_code == 200


def test_read_stays_open_without_key(monkeypatch):
    """GET is not in auth_required_methods, so reads must remain accessible."""
    c = TestClient(_guarded_app(monkeypatch))
    assert c.get("/r").status_code == 200
