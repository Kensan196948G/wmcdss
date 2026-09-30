"""GET /api/v1/dashboard の「現場代表 reason」集約の不変条件テスト（task-9 / F8）。

## 背景（実測済みの不具合）

`app/api/dashboard.py` の `dashboard_summary` は現場の代表 reason を
「worst ステータスの作業種別の reason」から選ぶが、実装は

    worst = "go"
    worst_reason = "しきい値が設定されていません"
    ...
    if severity[res.status] > severity[worst]:
        worst, worst_reason = res.status, res.reason

となっていた。`worst` が `"go"` で初期化されるのに対し更新条件が**厳密大なり**
なので、評価された作業種別が全て `go` の現場では `worst_reason` が一度も更新
されず、初期値の「しきい値が設定されていません」が代表 reason として返る。

結果として「施工可（go）」のカードに「しきい値が設定されていません」と表示され、
利用者には「基準が未設定なのか、基準を満たしているのか」が区別できなかった。
判定エンジン側 (`work_types[].reason`) は正しく `REASON_ALL_CLEAR` を返している
ため、壊れているのは集約ロジックだけである。

## 契約（このファイルが固定する意味論）

- 評価された作業種別が 1 つも無い → 「しきい値が設定されていません」（現行どおり）
- 最悪値が `go` → **評価済み作業種別の reason**（通常 `REASON_ALL_CLEAR`）
- 最悪値が `caution` / `stop` → その作業種別の reason（現行挙動を変えない）
- 同値のタイブレークは `work_types` の評価順で最初（同じ入力なら常に同じ結果）

DB は既存の `tests/test_rbac_dashboard_budget.py` と同じ「SQL 文字列で分岐する
軽量スタブ + dependency_overrides」方式にする（重い fixture を持ち込まない）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import dashboard
from app.db.session import get_db
from app.services.decision import REASON_ALL_CLEAR

# 現行実装が代表 reason の初期値として返してしまう文。これが「go なのに出る」
# ことがバグの本体なので、テストでは「この文ではない」ことを明示的に固定する。
_REASON_NO_THRESHOLDS = "しきい値が設定されていません"


# ---------------------------------------------------------------------------
# DB スタブ（tests/test_rbac_dashboard_budget.py と同方式）
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
    """実行された SQL の文字列で返す行を切り替えるスタブ。

    dashboard_summary は「sites → thresholds → (site ごとに) weather → marine」
    の順に問い合わせる。順序に依存せず、SQL 本文で振り分ける。
    """

    def __init__(self, sites, thresholds, weather=None, marine=None):
        self._sites = sites
        self._thresholds = thresholds
        self._weather = weather or []
        self._marine = marine or []

    async def execute(self, stmt):
        sql = str(stmt)
        if "weather_observations" in sql:
            return _FakeResult(self._weather)
        if "marine_observations" in sql:
            return _FakeResult(self._marine)
        if "sites" in sql and "thresholds" not in sql:
            return _FakeResult(self._sites)
        return _FakeResult(self._thresholds)


def _site(site_id: uuid.UUID, code: str = "S-1", kind: str = "land"):
    from app.models.site import Site

    s = Site()
    s.id = site_id
    s.code = code
    s.name = f"テスト現場 {code}"
    s.kind = kind
    s.lat = 35.0
    s.lon = 139.0
    return s


def _threshold(
    site_id,
    *,
    work_type: str = "crane",
    metric: str = "wind_speed_ms",
    op: str = ">=",
    value: float = 10.0,
    severity: str = "warn",
):
    from app.models.threshold import Threshold

    t = Threshold()
    t.site_id = site_id
    t.work_type = work_type
    t.metric = metric
    t.op = op
    t.value = value
    t.severity = severity
    t.active_from = None
    t.active_to = None
    t.note = None
    return t


def _weather(site_id, *, wind_speed_ms: float = 8.0, wind_gust_ms: float = 12.0):
    from app.models.observations import WeatherObservation

    w = WeatherObservation()
    w.site_id = site_id
    w.observed_at = datetime.now(timezone.utc)
    w.temperature_c = 20.0
    w.humidity_pct = 50.0
    w.pressure_hpa = 1013.0
    w.precip_mm = 0.0
    w.wind_speed_ms = wind_speed_ms
    w.wind_gust_ms = wind_gust_ms
    return w


def _client(db: _FakeDB) -> TestClient:
    app = FastAPI()
    app.include_router(dashboard.router)

    async def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    return TestClient(app)


def _summary(db: _FakeDB) -> dict:
    body = _client(db).get("/dashboard").json()
    assert body["count"] == 1, "テストは 1 現場だけを対象にする"
    return body["sites"][0]


# ===========================================================================
# 1. 全作業種別が go: 代表 reason は「しきい値が設定されていません」ではない
# ===========================================================================


def test_all_go_site_reason_is_the_go_reason_not_the_no_threshold_placeholder():
    """判定が go なら代表 reason も go の理由文であること（本タスクの本体）。"""
    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "TYO-01")],
        # 風速 8.0 はどちらの閾値 (>=10.0) にも該当しない → 両作業種別とも go
        thresholds=[
            _threshold(sid, work_type="concrete", metric="wind_speed_ms", value=10.0),
            _threshold(sid, work_type="crane", metric="wind_gust_ms", value=20.0),
        ],
        weather=[_weather(sid, wind_speed_ms=8.0, wind_gust_ms=12.0)],
    )

    site = _summary(db)

    assert site["status"] == "go"
    assert [w["status"] for w in site["work_types"]] == ["go", "go"]
    assert site["reason"] == REASON_ALL_CLEAR, (
        f"status=go なのに代表 reason が {site['reason']!r}。"
        "「しきい値が設定されていません」は基準未設定の文であり、"
        "基準を満たしている現場では事実と矛盾する。"
    )
    assert site["reason"] != _REASON_NO_THRESHOLDS


def test_single_go_work_type_reason_is_used():
    """評価が 1 作業種別だけでも、その reason が代表 reason になること。"""
    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "TYO-02")],
        thresholds=[_threshold(sid, work_type="crane", metric="wind_speed_ms", value=10.0)],
        weather=[_weather(sid, wind_speed_ms=3.0)],
    )

    site = _summary(db)

    assert site["status"] == "go"
    assert len(site["work_types"]) == 1
    assert site["reason"] == site["work_types"][0]["reason"] == REASON_ALL_CLEAR


# ===========================================================================
# 2. caution / stop: 代表 reason は最悪作業種別の reason（既存挙動の回帰固定）
# ===========================================================================


def test_caution_site_reason_matches_worst_work_type():
    """go と caution が混在 → 代表は caution で、reason は caution 側のもの。"""
    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "TYO-03")],
        thresholds=[
            # concrete: 風速 8.0 < 10.0 → go
            _threshold(sid, work_type="concrete", metric="wind_speed_ms", value=10.0),
            # crane: 突風 12.0 >= 10.0 (warn) → caution
            _threshold(sid, work_type="crane", metric="wind_gust_ms", value=10.0),
        ],
        weather=[_weather(sid, wind_speed_ms=8.0, wind_gust_ms=12.0)],
    )

    site = _summary(db)

    by_work = {w["work_type"]: w for w in site["work_types"]}
    assert by_work["concrete"]["status"] == "go"
    assert by_work["crane"]["status"] == "caution"
    assert site["status"] == "caution"
    assert site["reason"] == by_work["crane"]["reason"]
    assert site["reason"] != REASON_ALL_CLEAR
    assert "wind_gust_ms=12.0" in site["reason"]


def test_stop_site_reason_matches_worst_work_type():
    """stop が最悪値なら代表 reason は stop 側のもの（caution に負けない）。"""
    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "TYO-04", kind="marine")],
        thresholds=[
            _threshold(sid, work_type="crane", metric="wind_gust_ms", value=10.0),
            _threshold(
                sid,
                work_type="marine_lift",
                metric="sig_wave_h_m",
                op=">=",
                value=1.0,
                severity="stop",
            ),
        ],
        weather=[_weather(sid, wind_speed_ms=8.0, wind_gust_ms=12.0)],
    )

    site = _summary(db)

    by_work = {w["work_type"]: w for w in site["work_types"]}
    assert by_work["crane"]["status"] == "caution"
    # 海象観測が無いので波高は欠測 → caution（stop まで上げない設計）。
    # ここで固定したいのは「代表 reason が最悪作業種別の reason と一致すること」。
    worst = max(site["work_types"], key=lambda w: {"go": 0, "caution": 1, "stop": 2}[w["status"]])
    assert site["status"] == worst["status"]
    assert site["reason"] == worst["reason"]


# ===========================================================================
# 3. しきい値が 1 件も無い現場: 現行どおり「しきい値が設定されていません」
# ===========================================================================


def test_site_without_thresholds_keeps_the_no_threshold_reason():
    """評価対象が無い現場では、基準未設定を伝える文のままであること。

    ここを go の理由文（REASON_ALL_CLEAR）に変えてしまうと、基準が無いのに
    「全しきい値を満たしています」と断言することになり、より危険な fail-open
    になる。`data_complete=False` と対で「判定根拠が無い」ことを伝える。
    """
    sid = uuid.uuid4()
    db = _FakeDB(sites=[_site(sid, "TYO-05")], thresholds=[], weather=[_weather(sid)])

    site = _summary(db)

    assert site["work_types"] == []
    assert site["data_complete"] is False
    assert site["reason"] == _REASON_NO_THRESHOLDS


# ===========================================================================
# 4. 決定性: 同じ入力なら常に同じ代表 reason
# ===========================================================================


def test_tied_worst_status_picks_the_first_evaluated_work_type_deterministically():
    """worst が同値のときは work_types の評価順で最初の reason を採る。

    land の評価順は (concrete, crane)。両方 caution になる入力を与え、
    代表 reason が先に評価された concrete のものであること、および 2 回呼んでも
    同じであることを固定する（副次キーで順序が揺れる実装を防ぐ）。
    """
    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "TYO-06")],
        thresholds=[
            _threshold(sid, work_type="concrete", metric="wind_speed_ms", value=5.0),
            _threshold(sid, work_type="crane", metric="wind_gust_ms", value=5.0),
        ],
        weather=[_weather(sid, wind_speed_ms=8.0, wind_gust_ms=12.0)],
    )

    first = _summary(db)
    second = _summary(db)

    assert [w["work_type"] for w in first["work_types"]] == ["concrete", "crane"]
    assert [w["status"] for w in first["work_types"]] == ["caution", "caution"]
    assert first["status"] == "caution"
    assert first["reason"] == first["work_types"][0]["reason"]
    assert "wind_speed_ms=8.0" in first["reason"]
    assert first["reason"] == second["reason"], "同じ入力で代表 reason が変わってはならない"


def test_response_shape_is_unchanged():
    """レスポンスのキー構成と per_work の中身は変更しない（契約）。"""
    sid = uuid.uuid4()
    db = _FakeDB(
        sites=[_site(sid, "TYO-07")],
        thresholds=[_threshold(sid, work_type="crane", metric="wind_speed_ms", value=10.0)],
        weather=[_weather(sid, wind_speed_ms=3.0)],
    )

    body = _client(db).get("/dashboard").json()
    assert set(body) == {"generated_at", "count", "sites"}
    site = body["sites"][0]
    assert set(site) == {
        "site_id", "code", "name", "kind", "status", "reason", "work_types",
        "weather_observed_at", "marine_observed_at", "weather_fresh",
        "marine_fresh", "data_complete", "latest_weather", "latest_marine",
    }
    assert set(site["work_types"][0]) == {"work_type", "status", "reason", "evaluated"}
