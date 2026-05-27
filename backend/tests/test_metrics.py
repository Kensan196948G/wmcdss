"""Unit tests for /metrics endpoint and MetricsMiddleware — no DB required."""
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import config as config_mod
from app.core.security import APIKeyMiddleware
from app.core.ratelimit import RateLimitMiddleware
from app.core.monitoring import MetricsMiddleware
from app.api import metrics as metrics_mod


@pytest.fixture
def metrics_app(monkeypatch):
    """Minimal app with full middleware stack and API keys enabled."""
    fake = config_mod.Settings(api_keys=["test-key"], rate_limit_per_minute=60)
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)

    app = FastAPI()
    app.add_middleware(APIKeyMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(MetricsMiddleware)
    app.include_router(metrics_mod.router)

    @app.get("/probe")
    async def probe():
        return {"ok": True}

    return app


def test_metrics_returns_200(metrics_app):
    assert TestClient(metrics_app).get("/metrics").status_code == 200


def test_metrics_content_type_is_text_plain(metrics_app):
    r = TestClient(metrics_app).get("/metrics")
    assert "text/plain" in r.headers["content-type"]


def test_metrics_accessible_without_api_key(metrics_app):
    """Prometheus scraper sends no auth header — /metrics must pass without X-API-Key."""
    r = TestClient(metrics_app).get("/metrics")
    assert r.status_code == 200


def test_metrics_not_rate_limited(metrics_app):
    """Scraping /metrics repeatedly must never return 429."""
    c = TestClient(metrics_app)
    for _ in range(5):
        assert c.get("/metrics").status_code == 200


def test_metrics_contains_wmcdss_request_counter(metrics_app):
    """After a probe hit, wmcdss_http_requests_total must appear in output."""
    c = TestClient(metrics_app)
    c.get("/probe")
    r = c.get("/metrics")
    assert b"wmcdss_http_requests_total" in r.content


def test_metrics_contains_latency_histogram(metrics_app):
    """wmcdss_http_request_duration_seconds histogram must always be present."""
    r = TestClient(metrics_app).get("/metrics")
    assert b"wmcdss_http_request_duration_seconds" in r.content
