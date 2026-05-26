"""Black-box smoke tests against the running backend (docker-compose).

Tests run against http://backend:8000 (inside the compose network) and use
data_version=999 to isolate from production rows.
"""
from __future__ import annotations
import os
import uuid

import httpx
import pytest

BASE = os.environ.get("WMCDSS_TEST_BASE", "http://backend:8000")
TEST_DV = 999  # isolation marker — never used by ETL


@pytest.fixture(scope="module")
def client() -> httpx.Client:
    with httpx.Client(base_url=BASE, timeout=10.0) as c:
        yield c


@pytest.fixture(scope="module")
def site_id(client: httpx.Client) -> str:
    sites = client.get("/api/v1/sites").raise_for_status().json()
    assert sites, "seed data missing: no sites"
    return sites[0]["id"]


def test_root_advertises_new_endpoints(client: httpx.Client) -> None:
    body = client.get("/").raise_for_status().json()
    eps = set(body["endpoints"])
    assert {"/api/v1/thresholds", "/api/v1/observations/weather",
            "/api/v1/audit"}.issubset(eps)


def test_thresholds_merge_site_and_global(client: httpx.Client, site_id: str) -> None:
    rows = client.get("/api/v1/thresholds", params={"site_id": site_id}).raise_for_status().json()
    assert isinstance(rows, list)
    assert all(r["site_id"] in (None, site_id) for r in rows), \
        "list must only contain site-specific OR global rules"


def test_threshold_crud_roundtrip(client: httpx.Client) -> None:
    payload = {
        "site_id": None, "work_type": "_pytest", "metric": "wind_speed",
        "op": ">", "value": 99.9, "severity": "warn", "note": "pytest"
    }
    created = client.post("/api/v1/thresholds", json=payload,
                          headers={"X-Actor": "pytest"}).raise_for_status().json()
    tid = created["id"]
    try:
        got = client.get(f"/api/v1/thresholds/{tid}").raise_for_status().json()
        assert got["value"] == 99.9
        patched = client.patch(f"/api/v1/thresholds/{tid}",
                               json={"value": 88.8},
                               headers={"X-Actor": "pytest"}).raise_for_status().json()
        assert patched["value"] == 88.8
    finally:
        client.delete(f"/api/v1/thresholds/{tid}",
                      headers={"X-Actor": "pytest"}).raise_for_status()
        r = client.get(f"/api/v1/thresholds/{tid}")
        assert r.status_code == 404


def test_weather_ingest_is_idempotent(client: httpx.Client, site_id: str) -> None:
    payload = [{
        "site_id": site_id, "observed_at": "2026-01-01T00:00:00Z",
        "data_version": TEST_DV, "source": "pytest",
        "temperature_c": 10.0, "wind_speed_ms": 5.0,
    }]
    r1 = client.post("/api/v1/observations/weather", json=payload,
                     headers={"X-Actor": "pytest"}).raise_for_status().json()
    r2 = client.post("/api/v1/observations/weather", json=payload,
                     headers={"X-Actor": "pytest"}).raise_for_status().json()
    assert r1["total"] == r2["total"] == 1


def test_weather_validation_rejects_bad_humidity(client: httpx.Client, site_id: str) -> None:
    payload = [{
        "site_id": site_id, "observed_at": "2026-01-01T00:00:00Z",
        "data_version": TEST_DV, "humidity_pct": 150.0,
    }]
    r = client.post("/api/v1/observations/weather", json=payload)
    assert r.status_code == 422, "humidity > 100 must be rejected"


def test_latest_404_for_unknown_site(client: httpx.Client) -> None:
    r = client.get("/api/v1/observations/weather/latest",
                   params={"site_id": str(uuid.uuid4())})
    assert r.status_code == 404


def test_audit_log_contains_recent_writes(client: httpx.Client) -> None:
    rows = client.get("/api/v1/audit", params={"limit": 50}).raise_for_status().json()
    assert isinstance(rows, list)
    actions = {r["action"] for r in rows}
    assert "observation.weather.ingest" in actions or "threshold.create" in actions, \
        "earlier tests should have produced audit rows"
