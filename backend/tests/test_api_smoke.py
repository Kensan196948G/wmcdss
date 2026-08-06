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


def _bearer() -> dict[str, str]:
    """JWT を必要とする経路（/audit, /reports, /ai/*）用の Authorization ヘッダー。

    このスイートは `docker compose exec backend pytest` で backend コンテナの
    中から走るため、サーバープロセスと同じ環境変数を共有している。つまり
    同じ `WMCDSS_JWT_SECRET` で署名でき、発行したトークンはそのまま受理される。

    `/auth/login` を叩かずトークンを直接発行しているのは、CI の compose が
    `WMCDSS_LOCAL_USERS` を空のまま起動するためログインできる利用者が
    存在しないからである。テスト用の資格情報を workflow やリポジトリへ
    置く方式は採らない。ログイン経路自体は tests/test_auth.py が検証する。
    """
    from app.core.auth import create_access_token

    token = create_access_token(subject="pytest", auth_type="local")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def client() -> httpx.Client:
    # ブラウザ UI と同じく、常に Bearer を持った状態で叩く。認証を要する経路が
    # 今後増えても、このスイートが理由の分からない 401 で落ちないようにする。
    # 「認証が無いと弾かれる」側の検証は test_audit_requires_authentication と
    # tests/test_route_auth.py が担当する。
    with httpx.Client(base_url=BASE, timeout=10.0, headers=_bearer()) as c:
        yield c


@pytest.fixture(scope="module")
def anon_client() -> httpx.Client:
    """資格情報を一切持たないクライアント。"""
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


def test_decision_create_writes_audit(client: httpx.Client, site_id: str) -> None:
    payload = {
        "site_id": site_id,
        "work_type": "_pytest",
        "target_window_start": "2026-01-01T00:00:00Z",
        "target_window_end":   "2026-01-01T06:00:00Z",
    }
    created = client.post("/api/v1/decisions", json=payload,
                          headers={"X-Actor": "pytest"}).raise_for_status().json()
    did = created["id"]

    rows = client.get("/api/v1/audit", params={
        "actor": "pytest", "action": "decision.create", "target_id": did, "limit": 1,
    }).raise_for_status().json()
    assert len(rows) == 1, "decision.create must produce exactly one audit row per POST"
    detail = rows[0]["detail"]
    assert detail["site_id"] == site_id
    assert detail["work_type"] == "_pytest"
    assert detail["status"] in {"go", "caution", "stop"}
    assert "inputs" in detail and "matched_rules" in detail, \
        "README contract: inputs snapshot + matched rules must be persisted for replay"


def test_site_create_writes_audit(client: httpx.Client) -> None:
    code = f"_pyt_{uuid.uuid4().hex[:8]}"
    payload = {
        "code": code, "name": "pytest audit site",
        "kind": "land", "lat": 35.0, "lon": 139.0,
    }
    created = client.post("/api/v1/sites", json=payload,
                          headers={"X-Actor": "pytest"}).raise_for_status().json()
    sid = created["id"]

    rows = client.get("/api/v1/audit", params={
        "actor": "pytest", "action": "site.create", "target_id": sid, "limit": 1,
    }).raise_for_status().json()
    assert len(rows) == 1, "site.create must produce exactly one audit row per POST"
    detail = rows[0]["detail"]
    assert detail["code"] == code
    assert detail["kind"] == "land"


def test_audit_log_contains_recent_writes(client: httpx.Client) -> None:
    rows = client.get("/api/v1/audit", params={"limit": 50}).raise_for_status().json()
    assert isinstance(rows, list)
    actions = {r["action"] for r in rows}
    assert "observation.weather.ingest" in actions or "threshold.create" in actions, \
        "earlier tests should have produced audit rows"


def test_audit_requires_authentication(anon_client: httpx.Client) -> None:
    """監査ログは資格情報なしでは読めない。

    tests/test_route_auth.py が同じ不変条件を単体で押さえているが、あちらは
    アプリを in-process で組み立てて検証する。実際に配備された compose の
    ミドルウェア構成でも同じ結果になることは、ここでしか確認できない。
    `audit_log.actor` には操作者名が入るため、無認証で読めると組織内の
    利用実態が資格情報なしで観測できてしまう。
    """
    r = anon_client.get("/api/v1/audit", params={"limit": 1})
    assert r.status_code == 401, f"expected 401 without credentials, got {r.status_code}"
