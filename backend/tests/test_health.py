"""Unit tests for /healthz and /readyz contract — pin the HTTP status code
boundary so orchestrators (k8s readiness probe, docker healthcheck, LB) can
reliably distinguish 'ready' from 'degraded'. Prior to Loop 45 the DB-failure
branch silently returned 200 with status='degraded', defeating the probe.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.health import router
from app.db.session import get_db


def _make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    return app


def test_healthz_returns_200():
    # /healthz is a pure liveness probe — no dependency on DB. Must always
    # respond 200 as long as the event loop is alive.
    app = _make_app()
    with TestClient(app) as c:
        r = c.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_readyz_returns_200_when_db_healthy():
    app = _make_app()

    class _FakeOk:
        async def execute(self, _stmt):
            return None

    async def _override():
        yield _FakeOk()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        r = c.get("/readyz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["db"] == "ok"


def test_readyz_returns_503_when_db_unreachable():
    # The orchestrator contract: DB failure MUST surface as a non-2xx so
    # `curl -sf` (CI smoke) and kubelet readiness probes fail fast and stop
    # routing traffic. Returning 200 here was a Loop 45 silent-failure fix.
    app = _make_app()

    class _FakeBroken:
        async def execute(self, _stmt):
            raise RuntimeError("connection refused: db down")

    async def _override():
        yield _FakeBroken()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        r = c.get("/readyz")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert "connection refused" in body["db"]
