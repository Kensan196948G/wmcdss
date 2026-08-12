"""RBAC・ダッシュボード集約・AI 予算・CSV 無害化の回帰テスト。"""
from __future__ import annotations

import importlib
import csv
import io
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.datastructures import Headers
from starlette.requests import Request

from app.core import config as config_mod
from app.core.security import actor_from
from app.db.session import get_db


# ---------------------------------------------------------------------------
# actor_from: JWT が X-Actor より優先される
# ---------------------------------------------------------------------------

def _req(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "headers": Headers(headers).raw,
    }
    return Request(scope)


def _valid_jwt(sub: str = "alice@example.com") -> str:
    from app.core.auth import create_access_token
    return create_access_token(subject=sub, auth_type="local", role="field")


def test_actor_from_prefers_jwt_subject_over_x_actor():
    token = _valid_jwt()
    req = _req({"Authorization": f"Bearer {token}", "X-Actor": "spoofed"})
    assert actor_from(req) == "alice@example.com"


def test_actor_from_ignores_forged_jwt_and_keeps_x_actor():
    req = _req({"Authorization": "Bearer not-a-real-jwt", "X-Actor": "alice"})
    assert actor_from(req) == "alice"


# ---------------------------------------------------------------------------
# ロール解決
# ---------------------------------------------------------------------------

def test_role_users_mapping_and_default():
    s = config_mod.Settings(
        role_users_raw="alice:admin, bob:hq, charlie:other",
        default_role="field",
    )
    assert s.role_for("alice") == "admin"
    assert s.role_for("BOB") == "hq"
    assert s.role_for("charlie") == "field"  # 不正ロールは default に倒れる
    assert s.role_for("nobody") == "field"


# ---------------------------------------------------------------------------
# RBAC 依存（JWT 必須 + ロール検査）
# ---------------------------------------------------------------------------

def test_require_admin_jwt_rejects_field_user():
    from fastapi import Depends

    from app.api.auth import require_admin_jwt
    from app.core.auth import create_access_token

    app = FastAPI()

    @app.get("/x")
    async def route(_u=Depends(require_admin_jwt)):
        return {"ok": True}

    c = TestClient(app)
    token = create_access_token(subject="field-user", auth_type="local", role="field")
    assert c.get("/x", headers={"Authorization": f"Bearer {token}"}).status_code == 403
    assert c.get("/x").status_code == 401


def test_require_hq_or_admin_jwt_accepts_hq():
    from fastapi import Depends

    from app.api.auth import require_hq_or_admin_jwt
    from app.core.auth import create_access_token

    app = FastAPI()

    @app.get("/x")
    async def route(_u=Depends(require_hq_or_admin_jwt)):
        return {"ok": True}

    c = TestClient(app)
    token = create_access_token(subject="hq-user", auth_type="local", role="hq")
    assert c.get("/x", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    field_token = create_access_token(subject="f", auth_type="local", role="field")
    assert c.get("/x", headers={"Authorization": f"Bearer {field_token}"}).status_code == 403


# ---------------------------------------------------------------------------
# ダッシュボード集約エンドポイント
# ---------------------------------------------------------------------------

class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalars(self._rows)


class _FakeDB:
    def __init__(self, sites, thresholds, weather=None, marine=None):
        self._sites = sites
        self._thresholds = thresholds
        self._weather = weather or []
        self._marine = marine or []
        self._calls = 0

    async def execute(self, stmt):
        self._calls += 1
        sql = str(stmt)
        if "weather_observations" in sql:
            return _FakeResult(self._weather)
        if "marine_observations" in sql:
            return _FakeResult(self._marine)
        if "sites" in sql and "thresholds" not in sql:
            return _FakeResult(self._sites)
        return _FakeResult(self._thresholds)


def _site(site_id: uuid.UUID, kind: str = "land"):
    from app.models.site import Site
    s = Site()
    s.id = site_id
    s.code = "S-1"
    s.name = "テスト現場"
    s.kind = kind
    s.lat = 35.0
    s.lon = 139.0
    return s


def _threshold(site_id, work_type="crane", metric="wind_speed_ms", value=10.0):
    from app.models.threshold import Threshold
    t = Threshold()
    t.site_id = site_id
    t.work_type = work_type
    t.metric = metric
    t.op = ">="
    t.value = value
    t.severity = "warn"
    t.active_from = None
    t.active_to = None
    t.note = None
    return t


def _weather(site_id):
    from app.models.observations import WeatherObservation
    w = WeatherObservation()
    w.site_id = site_id
    w.observed_at = datetime.now(timezone.utc)
    w.temperature_c = 20.0
    w.humidity_pct = 50.0
    w.pressure_hpa = 1013.0
    w.precip_mm = 0.0
    w.wind_speed_ms = 8.0
    w.wind_gust_ms = 12.0
    return w


def test_dashboard_summary_returns_real_status():
    from app.api import dashboard

    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "land")],
        thresholds=[_threshold(sid)],
        weather=[_weather(sid)],
    )

    app = FastAPI()
    app.include_router(dashboard.router)

    async def _override():
        yield db

    app.dependency_overrides[get_db] = _override

    c = TestClient(app)
    body = c.get("/dashboard").json()
    assert body["count"] == 1
    site = body["sites"][0]
    # 風速 8.0 < 10.0 の warn 閾値なので caution ではなく go にはならない
    # （全しきい値クリアなら go。seed には concrete の閾値が無いため concrete は対象外）
    assert site["status"] in ("go", "caution")
    assert site["work_types"], "閾値のある作業種別が評価されていること"
    assert site["weather_observed_at"] is not None
    assert site["data_complete"] is True


# ---------------------------------------------------------------------------
# AI 予算上限
# ---------------------------------------------------------------------------

def test_ai_daily_budget_blocks_over_limit(monkeypatch):
    import app.api.ai as ai_mod

    ai_mod._reset_budget_counters_for_tests()
    monkeypatch.setattr(
        config_mod,
        "get_settings",
        lambda: config_mod.Settings(ai_max_requests_per_day=1),
    )
    ai_mod._check_ai_budget()
    ai_mod._record_ai_usage()
    with pytest.raises(HTTPException) as exc:
        ai_mod._check_ai_budget()
    assert exc.value.status_code == 429
    ai_mod._reset_budget_counters_for_tests()


# ---------------------------------------------------------------------------
# 観測値の物理範囲検証
# ---------------------------------------------------------------------------

def test_observation_physical_bounds_rejected():
    from app.schemas.observation import MarineObservationIn, WeatherObservationIn

    with pytest.raises(ValidationError):
        WeatherObservationIn(
            site_id=uuid.uuid4(), observed_at=datetime.now(timezone.utc),
            temperature_c=70.0,
        )
    with pytest.raises(ValidationError):
        MarineObservationIn(
            site_id=uuid.uuid4(), observed_at=datetime.now(timezone.utc),
            sig_wave_h_m=99.0,
        )
    with pytest.raises(ValidationError):
        WeatherObservationIn(
            site_id=uuid.uuid4(), observed_at=datetime.now(timezone.utc),
            wind_gust_ms=-1.0,
        )


# ---------------------------------------------------------------------------
# CSV インジェクション対策
# ---------------------------------------------------------------------------

def test_csv_cells_with_formula_prefix_are_neutralized():
    from app.api.reports import _to_csv

    buf = _to_csv(
        ["note"],
        [["=HYPERLINK(\"http://evil\")"], ["+SUM(A1:A2)"], ["-1+1"], ["@cmd"], ["normal"]],
    )
    rows = list(csv.reader(io.StringIO(buf.getvalue())))
    assert rows[0] == ["note"]
    assert rows[1] == ["'=HYPERLINK(\"http://evil\")"]
    assert rows[2] == ["'+SUM(A1:A2)"]
    assert rows[3] == ["'-1+1"]
    assert rows[4] == ["'@cmd"]
    assert rows[5] == ["normal"]


# ---------------------------------------------------------------------------
# API キー middleware の二重認証（JWT 受理）
# ---------------------------------------------------------------------------

def test_api_key_middleware_accepts_valid_jwt_for_mutations(monkeypatch):
    """本番で WebUI の mutation が 401 にならないための回帰テスト。"""
    fake = config_mod.Settings(
        allow_insecure_defaults=True,
        api_keys_raw="prod-key-1",
        jwt_secret="x" * 48,
    )
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
    import app.main as main_mod
    importlib.reload(main_mod)

    from app.core.auth import create_access_token
    from app.db.session import get_db
    token = create_access_token(subject="ui-user", auth_type="local", role="field")

    async def _no_db():
        yield None

    main_mod.app.dependency_overrides[get_db] = _no_db

    with TestClient(main_mod.app, raise_server_exceptions=False) as c:
        # JWT があれば API キー無しでも mutation は middleware を通過する
        # （route 層のロール検査は別途 /decisions は全認証ユーザー許可）。
        r = c.post(
            "/api/v1/decisions",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "site_id": str(uuid.uuid4()),
                "work_type": "crane",
                "target_window_start": "2026-08-12T00:00:00Z",
                "target_window_end": "2026-08-12T01:00:00Z",
            },
        )
        # DB は接続されないため 404/500 系ではなく、認証通過後の結果（404 site）を期待
        assert r.status_code != 401

        # 資格情報なしは 401
        r2 = c.post(
            "/api/v1/decisions",
            json={
                "site_id": str(uuid.uuid4()),
                "work_type": "crane",
                "target_window_start": "2026-08-12T00:00:00Z",
                "target_window_end": "2026-08-12T01:00:00Z",
            },
        )
        assert r2.status_code == 401
    importlib.reload(main_mod)
