"""Tests for the WMCDSS_EXPOSE_OPENAPI policy.

Production deployments set `WMCDSS_EXPOSE_OPENAPI=false` so the schema and
docs UIs return 404 to anonymous traffic. The dev default leaves them on so
local exploration stays friction-free — same stance as `api_keys=[]`.

We rebuild the FastAPI app in-process per test (rather than importing the
module-level `app`) because `expose_openapi` is read at construction time
and FastAPI does not support flipping `openapi_url` after instantiation.
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from app.core import config as config_mod


@pytest.fixture
def build_app(monkeypatch):
    """Rebuild app.main with a patched Settings so the FastAPI ctor sees it."""
    def _build(*, expose_openapi: bool):
        fake = config_mod.Settings(expose_openapi=expose_openapi)
        monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
        # Reload main so its module-level `app = FastAPI(...)` runs again with
        # the patched settings — mirrors how a fresh container would start.
        import app.main as main_mod
        importlib.reload(main_mod)
        return main_mod.app
    yield _build
    # Restore the canonical app so other tests / smoke runs aren't affected.
    import app.main as main_mod
    importlib.reload(main_mod)


def test_default_exposes_openapi_and_docs(build_app):
    client = TestClient(build_app(expose_openapi=True))
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200


def test_disabled_hides_openapi_and_docs(build_app):
    client = TestClient(build_app(expose_openapi=False))
    # All three surfaces vanish — the routes aren't registered, so FastAPI
    # returns its standard 404 without ever consulting our middleware.
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404


def test_disabled_still_serves_healthz(build_app):
    # Defensive check: hiding OpenAPI must not accidentally take down probes.
    client = TestClient(build_app(expose_openapi=False))
    assert client.get("/healthz").status_code == 200


def test_disabled_still_serves_root_endpoints_list(build_app):
    # The `/` advertisement is hand-rolled (not derived from OpenAPI) so it
    # must remain available even when the schema is hidden.
    client = TestClient(build_app(expose_openapi=False))
    r = client.get("/")
    assert r.status_code == 200
    assert "endpoints" in r.json()
