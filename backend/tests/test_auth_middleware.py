"""Unit tests for APIKeyMiddleware in isolation (no DB required)."""
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import config as config_mod
from app.core import security as security_mod
from app.core.security import APIKeyMiddleware


@pytest.fixture
def make_app(monkeypatch):
    def _build(keys: list[str]) -> FastAPI:
        fake = config_mod.Settings(api_keys=keys)
        monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
        monkeypatch.setattr(security_mod, "_config", config_mod)

        app = FastAPI()
        app.add_middleware(APIKeyMiddleware)

        @app.get("/r")
        async def r(): return {"ok": True}

        @app.post("/w")
        async def w(): return {"ok": True}

        @app.get("/healthz")
        async def hz(): return {"ok": True}

        return app
    return _build


def test_disabled_when_keys_empty(make_app):
    c = TestClient(make_app([]))
    assert c.post("/w").status_code == 200
    assert c.get("/r").status_code == 200


def test_reads_pass_without_key(make_app):
    assert TestClient(make_app(["secret"])).get("/r").status_code == 200


def test_writes_blocked_without_key(make_app):
    r = TestClient(make_app(["secret"])).post("/w")
    assert r.status_code == 401
    assert "X-API-Key" in r.json()["detail"]


def test_writes_blocked_with_wrong_key(make_app):
    r = TestClient(make_app(["secret"])).post("/w", headers={"X-API-Key": "wrong"})
    assert r.status_code == 401


def test_writes_accepted_with_valid_key(make_app):
    app = make_app(["secret", "alt"])
    for k in ("secret", "alt"):
        r = TestClient(app).post("/w", headers={"X-API-Key": k})
        assert r.status_code == 200, f"key={k}"


def test_exempt_paths_bypass_auth(make_app):
    assert TestClient(make_app(["secret"])).get("/healthz").status_code == 200
