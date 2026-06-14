"""Tests for /api/v1/auth/* endpoints.

Covers:
  POST /api/v1/auth/login        — local user auth (success, bad password, unknown user, validation)
  POST /api/v1/auth/login/m365   — M365 ROPC (disabled, bad creds, success)
  GET  /api/v1/auth/me           — JWT validation (valid, missing, invalid)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.auth as api_auth_mod
import app.core.auth as core_auth_mod
from app.api.auth import router
from app.core.config import Settings

# bcrypt hash of 'testpass123' (generated offline — avoid slow hash in CI)
_HASHED = "$2b$12$jh1EnQculq3PRXhpsDiyZeED9HJO2idI.KyjjbESj.BETA0NexhJG"
_LOCAL_USERS = f"admin:{_HASHED}"


def _settings(**overrides) -> Settings:
    defaults: dict = dict(
        api_keys_raw="",
        local_users=_LOCAL_USERS,
        jwt_secret="test-secret-key-32chars-padding!",
        jwt_algorithm="HS256",
        jwt_expire_minutes=60,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _make_client(monkeypatch, fake: Settings | None = None) -> TestClient:
    s = fake or _settings()
    monkeypatch.setattr(core_auth_mod, "get_settings", lambda: s)
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: s)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login — local auth
# ---------------------------------------------------------------------------


def test_login_local_success(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login", json={"username": "admin", "password": "testpass123"})
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "admin"
    assert body["auth_type"] == "local"
    assert body["token_type"] == "bearer"
    assert "access_token" in body
    assert body["expires_in_minutes"] == 60


def test_login_local_wrong_password(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login", json={"username": "admin", "password": "wrongpass"})
    assert r.status_code == 401


def test_login_local_unknown_user(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login", json={"username": "ghost", "password": "testpass123"})
    assert r.status_code == 401


def test_login_local_empty_username_rejected(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login", json={"username": "   ", "password": "testpass123"})
    assert r.status_code == 422


def test_login_local_empty_password_rejected(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login", json={"username": "admin", "password": ""})
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/auth/login/m365 — M365 ROPC
# ---------------------------------------------------------------------------


def test_login_m365_disabled_returns_503(monkeypatch):
    # entra_enabled=False when tenant_id/client_id/client_secret are empty (default)
    c = _make_client(monkeypatch, _settings())
    r = c.post("/api/v1/auth/login/m365", json={"email": "user@example.com", "password": "pw"})
    assert r.status_code == 503


def test_login_m365_invalid_email_format(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login/m365", json={"email": "not-an-email", "password": "pw"})
    assert r.status_code == 422


def test_login_m365_bad_credentials_returns_401(monkeypatch):
    fake = _settings(
        entra_tenant_id="tenant-id",
        entra_client_id="client-id",
        entra_client_secret="client-secret",
        entra_email_domain="example.com",
    )
    c = _make_client(monkeypatch, fake)

    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.headers = {"content-type": "application/json"}
    mock_resp.json.return_value = {"error": "invalid_grant", "error_description": "bad creds"}

    async_client_mock = AsyncMock()
    async_client_mock.__aenter__ = AsyncMock(return_value=async_client_mock)
    async_client_mock.__aexit__ = AsyncMock(return_value=False)
    async_client_mock.post = AsyncMock(return_value=mock_resp)

    with patch("app.core.auth.httpx.AsyncClient", return_value=async_client_mock):
        r = c.post(
            "/api/v1/auth/login/m365",
            json={"email": "user@example.com", "password": "badpw"},
        )

    assert r.status_code == 401


def test_login_m365_success(monkeypatch):
    fake = _settings(
        entra_tenant_id="tenant-id",
        entra_client_id="client-id",
        entra_client_secret="client-secret",
        entra_email_domain="example.com",
    )
    c = _make_client(monkeypatch, fake)

    token_resp = MagicMock()
    token_resp.status_code = 200
    token_resp.headers = {"content-type": "application/json"}
    token_resp.json.return_value = {"access_token": "ms-access-token"}

    me_resp = MagicMock()
    me_resp.status_code = 200
    me_resp.json.return_value = {
        "displayName": "Test User",
        "mail": "user@example.com",
    }

    # authenticate_m365 creates two AsyncClient contexts: one for token, one for Graph
    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return token_resp

        async def get(self, *args, **kwargs):
            return me_resp

    with patch("app.core.auth.httpx.AsyncClient", _FakeClient):
        r = c.post(
            "/api/v1/auth/login/m365",
            json={"email": "user@example.com", "password": "valid-pw"},
        )

    assert r.status_code == 200
    body = r.json()
    assert body["auth_type"] == "m365"
    assert "access_token" in body


# ---------------------------------------------------------------------------
# GET /api/v1/auth/me — JWT validation
# ---------------------------------------------------------------------------


def _get_valid_token(monkeypatch) -> str:
    """Login and return a real JWT for use in subsequent requests."""
    c = _make_client(monkeypatch)
    r = c.post("/api/v1/auth/login", json={"username": "admin", "password": "testpass123"})
    assert r.status_code == 200
    return r.json()["access_token"]


def test_get_me_with_valid_token(monkeypatch):
    token = _get_valid_token(monkeypatch)
    c = _make_client(monkeypatch)
    r = c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "admin"
    assert body["auth_type"] == "local"


def test_get_me_without_token_returns_401(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.get("/api/v1/auth/me")
    assert r.status_code == 401


def test_get_me_with_invalid_token_returns_401(monkeypatch):
    c = _make_client(monkeypatch)
    r = c.get("/api/v1/auth/me", headers={"Authorization": "Bearer totally.invalid.token"})
    assert r.status_code == 401


def test_get_me_with_wrong_secret_returns_401(monkeypatch):
    # Token signed with a different secret must be rejected
    fake_wrong = _settings(jwt_secret="wrong-secret-key-padding!!!!!!")
    c_wrong = _make_client(monkeypatch, fake_wrong)
    r_login = c_wrong.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "testpass123"}
    )
    bad_token = r_login.json()["access_token"]

    # Now verify with correct secret — should reject
    c = _make_client(monkeypatch)
    r = c.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {bad_token}"})
    assert r.status_code == 401
