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


def test_root_exempt_does_not_bypass_other_paths(monkeypatch):
    # Regression: if someone re-adds "/" to auth_exempt_paths, ensure the
    # prefix logic does NOT make every URL auth-free.
    fake = config_mod.Settings(api_keys=["secret"], auth_exempt_paths=["/", "/healthz"])
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(security_mod, "_config", config_mod)

    app = FastAPI()
    app.add_middleware(APIKeyMiddleware)

    @app.post("/w")
    async def w(): return {"ok": True}

    assert TestClient(app).post("/w").status_code == 401


def test_key_matches_non_ascii_rejected_cleanly():
    # Regression: hmac.compare_digest raises TypeError on str with non-ASCII.
    # _key_matches must encode to bytes and return False, not propagate.
    assert security_mod._key_matches("鍵", ["secret"]) is False


def test_key_matches_oversize_rejected():
    # CPU-amplification guard: bound the bytes passed to compare_digest.
    assert security_mod._key_matches("a" * 10_000, ["secret"]) is False


def test_oversize_key_via_http_rejected(make_app):
    big = "a" * 10_000
    r = TestClient(make_app(["secret"])).post("/w", headers={"X-API-Key": big})
    assert r.status_code == 401
