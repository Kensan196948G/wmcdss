"""Unit tests for POST /decisions endpoint — no DB required."""
from __future__ import annotations
import json
import uuid
from datetime import date, datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.api.decisions import router
from app.db.session import get_db
from app.models.observations import WeatherObservation, MarineObservation
from app.models.threshold import Threshold
from app.services.decision import REASON_ALL_CLEAR

_NOW = datetime(2026, 5, 27, 9, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fake DB helpers
# ---------------------------------------------------------------------------

class _FakeResult:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else self._scalar


class _FakeDB:
    """Multi-return fake: each execute() call returns the next preconfigured result.

    Raises AssertionError if execute() is called more times than configured.
    This ensures unexpected DB calls surface immediately rather than silently
    reusing stale data.
    """
    def __init__(self, execute_returns=None):
        self._returns = list(execute_returns or [])
        self._call_idx = 0

    async def execute(self, stmt):
        if self._call_idx >= len(self._returns):
            raise AssertionError(
                f"_FakeDB.execute() call #{self._call_idx + 1} not configured; "
                f"{len(self._returns)} return(s) available. "
                "Pass execute_returns= to _FakeDB for each expected execute() call."
            )
        result = self._returns[self._call_idx]
        self._call_idx += 1
        return result

    def add(self, obj): pass
    async def flush(self): pass
    async def commit(self): pass

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "generated_at", None) is None:
            obj.generated_at = _NOW

    async def delete(self, obj): pass


class _FlushFailDB(_FakeDB):
    """Raises SQLAlchemyError on the 2nd flush() — simulates audit DB failure.

    In create_decision: 1st flush = business Decision row, 2nd flush = AuditLog
    row via write_audit(strict=True). strict=True re-raises, ensuring the
    surrounding db.commit() is skipped and the decision is not persisted.
    """
    def __init__(self, execute_returns=None):
        super().__init__(execute_returns)
        self._flush_count = 0

    async def flush(self):
        self._flush_count += 1
        if self._flush_count == 2:
            raise SQLAlchemyError("simulated audit flush failure")


class _CapturingDB(_FakeDB):
    """`add()` されたオブジェクトを保持する。永続化直前の値そのものを見るため。

    レスポンス JSON では `date` も文字列に見える（FastAPI が直列化する）。
    そのため JSONB 列へ `date` オブジェクトがそのまま渡る不具合は、API の
    レスポンスを見ても検出できない。asyncpg へ実際に渡る値を検査する必要がある。
    """
    def __init__(self, execute_returns=None):
        super().__init__(execute_returns)
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)


def _make_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def _override():
        yield fake_db

    app.dependency_overrides[get_db] = _override
    return app


# ---------------------------------------------------------------------------
# Fake model factories
# ---------------------------------------------------------------------------

SITE_ID = uuid.uuid4()


def _payload(**overrides) -> dict:
    """Return a valid DecisionRequest payload dict with optional overrides."""
    base = {
        "site_id": str(SITE_ID),
        "work_type": "concrete",
        "target_window_start": "2026-05-27T06:00:00Z",
        "target_window_end": "2026-05-27T18:00:00Z",
    }
    return {**base, **overrides}


def _empty_3() -> list[_FakeResult]:
    """Three empty execute returns: thresholds → weather → marine."""
    return [_FakeResult(), _FakeResult(), _FakeResult()]


def _fake_threshold(
    metric: str, op: str, value: float, severity: str,
    active_from: date | None = None, active_to: date | None = None,
) -> Threshold:
    # active_from / active_to は既定 None（＝無期限）。seed の INSERT が両列を
    # 指定せず既存データが全行 NULL であることに合わせてある。既存テストは
    # 引数を渡さないため、有効期間の導入前後で振る舞いが変わらない。
    t = Threshold()
    t.work_type = "concrete"
    t.metric = metric
    t.op = op
    t.value = value
    t.severity = severity
    t.site_id = None
    t.note = None
    t.active_from = active_from
    t.active_to = active_to
    return t


def _fake_weather(**kwargs) -> WeatherObservation:
    w = WeatherObservation()
    w.temperature_c = kwargs.get("temperature_c")
    w.humidity_pct = kwargs.get("humidity_pct")
    w.precip_mm = kwargs.get("precip_mm")
    w.wind_speed_ms = kwargs.get("wind_speed_ms")
    w.wind_gust_ms = kwargs.get("wind_gust_ms")
    return w


def _fake_marine(**kwargs) -> MarineObservation:
    m = MarineObservation()
    m.sig_wave_h_m = kwargs.get("sig_wave_h_m")
    m.wave_period_s = kwargs.get("wave_period_s")
    return m


# ---------------------------------------------------------------------------
# POST /decisions — window validation
# ---------------------------------------------------------------------------

def test_create_decision_400_when_window_reversed():
    c = TestClient(_make_app(_FakeDB()))
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-05-27T18:00:00Z",
        target_window_end="2026-05-27T06:00:00Z",
    ))
    assert r.status_code == 400
    assert "target_window_end" in r.json()["detail"]


def test_create_decision_400_when_window_equal():
    c = TestClient(_make_app(_FakeDB()))
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-05-27T09:00:00Z",
        target_window_end="2026-05-27T09:00:00Z",
    ))
    assert r.status_code == 400
    assert "target_window_end" in r.json()["detail"]


# ---------------------------------------------------------------------------
# POST /decisions — decision status outcomes
# ---------------------------------------------------------------------------

def test_create_decision_caution_when_no_thresholds_configured():
    """しきい値も観測値も無い状態は「施工可」ではない。

    以前はここで status="go" ／ 理由「全しきい値を満たしています。施工可。」を
    返していた。`_empty_3()` は「しきい値 0 件・気象 0 件・海象 0 件」であり、
    一件も評価していないのに全件クリアと断言する状態だった。新規 site を
    登録した直後や ETL 停止中に、そのまま画面へ「施工可」と出る。
    """
    c = TestClient(_make_app(_FakeDB(_empty_3())))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "caution"
    assert REASON_ALL_CLEAR not in r.json()["reason"]
    assert "1 件も設定されていません" in r.json()["reason"]


def test_create_decision_caution_when_observations_missing():
    """しきい値はあるが観測値が無い場合も go にしない。

    `_latest_inputs` は観測行が 1 件も無いと 7 メトリクス全てを None で返す。
    その状態でしきい値だけ設定されていると、全ルールが評価不能になる。
    """
    returns = [
        _FakeResult(rows=[_fake_threshold("wind_speed_ms", ">=", 10.0, "warn")]),
        _FakeResult(),   # weather: 観測行なし
        _FakeResult(),   # marine:  観測行なし
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "caution"
    assert "wind_speed_ms" in r.json()["reason"]
    snapshot = r.json()["thresholds_snapshot"]
    assert snapshot["evaluated"] == 0
    assert len(snapshot["unevaluated"]) == 1


def test_create_decision_caution_when_warn_threshold_met():
    returns = [
        _FakeResult(rows=[_fake_threshold("wind_speed_ms", ">=", 10.0, "warn")]),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=15.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "caution"
    assert "wind_speed_ms=15.0" in r.json()["reason"]
    assert "[warn]" in r.json()["reason"]


def test_create_decision_stop_when_stop_threshold_met():
    returns = [
        _FakeResult(rows=[_fake_threshold("precip_mm_1h", ">=", 3.0, "stop")]),
        _FakeResult(rows=[_fake_weather(precip_mm=5.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "stop"
    assert r.json()["inputs"]["precip_mm_1h"] == 5.0
    assert "precip_mm_1h=5.0" in r.json()["reason"]
    assert "[stop]" in r.json()["reason"]


def test_create_decision_stop_beats_caution_warn_first():
    """warn listed first, stop listed second — worst-case must still win."""
    returns = [
        _FakeResult(rows=[
            _fake_threshold("wind_speed_ms", ">=", 10.0, "warn"),
            _fake_threshold("precip_mm_1h", ">=", 3.0, "stop"),
        ]),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=15.0, precip_mm=5.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "stop"
    snapshot = r.json()["thresholds_snapshot"]["rules"]
    assert len(snapshot) == 2
    assert {rule["metric"] for rule in snapshot} == {"wind_speed_ms", "precip_mm_1h"}


def test_create_decision_stop_beats_caution_stop_first():
    """stop listed first — insertion order must not change the worst-case outcome."""
    returns = [
        _FakeResult(rows=[
            _fake_threshold("precip_mm_1h", ">=", 3.0, "stop"),
            _fake_threshold("wind_speed_ms", ">=", 10.0, "warn"),
        ]),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=15.0, precip_mm=5.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "stop"


def test_create_decision_go_when_threshold_not_met():
    """Threshold defined but observed value is below it — status stays go."""
    returns = [
        _FakeResult(rows=[_fake_threshold("wind_speed_ms", ">=", 10.0, "warn")]),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=5.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "go"
    # 「評価して該当しなかった」ことの証跡。matched_rules は発火分しか残さない
    # ため、この件数が無いと未設定 (evaluated=0) と区別できない。
    assert r.json()["thresholds_snapshot"]["evaluated"] == 1


# ---------------------------------------------------------------------------
# POST /decisions — response shape
# ---------------------------------------------------------------------------

def test_create_decision_response_shape():
    c = TestClient(_make_app(_FakeDB(_empty_3())))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    body = r.json()
    uuid.UUID(body["id"])  # raises ValueError if malformed
    assert set(body["inputs"].keys()) == {
        "temperature_c", "humidity_pct", "precip_mm_1h",
        "wind_speed_ms", "wind_gust_ms", "sig_wave_h_m", "wave_period_s",
    }
    # 完全一致で固定しているのは意図的。監査スナップショットへキーが増減したら
    # 必ずこのテストが落ち、変更を意識せず監査の形を変えられないようにする。
    assert body["thresholds_snapshot"] == {
        "rules": [], "unevaluated": [], "out_of_effect": [], "evaluated": 0,
    }
    assert "generated_at" in body
    assert body["status"] in {"go", "caution", "stop"}
    assert body["work_type"] == "concrete"
    assert body["site_id"] == str(SITE_ID)


def test_create_decision_marine_threshold_met():
    """Marine observation triggers stop status."""
    returns = [
        _FakeResult(rows=[_fake_threshold("sig_wave_h_m", ">=", 2.0, "stop")]),
        _FakeResult(),
        _FakeResult(rows=[_fake_marine(sig_wave_h_m=2.5)]),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "stop"
    assert "sig_wave_h_m" in r.json()["reason"]
    assert "sig_wave_h_m=2.5" in r.json()["reason"]


# ---------------------------------------------------------------------------
# POST /decisions — write_audit strict=True contract
# ---------------------------------------------------------------------------

def test_create_decision_500_when_audit_flush_fails():
    """write_audit(strict=True) re-raises SQLAlchemyError → endpoint returns 500.

    Guards the atomic contract: every decision is either fully recorded in the
    audit log or not persisted at all. If audit fails silently, a decision with
    no audit trail would exist — a security/compliance violation.

    raise_server_exceptions=False: SQLAlchemyError is unhandled in the endpoint,
    so TestClient must convert it to an HTTP 500 rather than re-raising it.
    """
    db = _FlushFailDB(_empty_3())
    c = TestClient(_make_app(db), raise_server_exceptions=False)
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 500


# ---------------------------------------------------------------------------
# しきい値の有効期間（R-1）— API 経路
#
# `_load_thresholds` は `active_from` / `active_to` を一切参照していなかった。
# `evaluate` が最悪値を採るため、季節別しきい値を登録すると冬季基準と通常期
# 基準が年間を通じて同時に効き、常に厳しい方だけが適用される。倒れる先は
# 安全側だが、設定した意図どおりには一度も動かない。
#
# `_payload()` の施工時間帯は 2026-05-27T06:00Z〜18:00Z（JST 5/27 15:00 〜
# 5/28 03:00）。以下の「冬季基準」は 2026-03-31 で失効しており対象外になる。
# ---------------------------------------------------------------------------

def _seasonal_thresholds() -> list[Threshold]:
    """冬季（失効済）と通常期（有効）の 2 本立て。値は冬季の方が厳しい。"""
    return [
        _fake_threshold("wind_speed_ms", ">=", 8.0, "warn",
                        active_from=date(2025, 12, 1), active_to=date(2026, 3, 31)),
        _fake_threshold("wind_speed_ms", ">=", 10.0, "warn",
                        active_from=date(2026, 4, 1)),
    ]


def test_expired_threshold_is_excluded_from_the_judgement():
    """失効した冬季基準は発火しない — R-1 の中心的な回帰テスト。

    風速 9.0 m/s は冬季基準 (>=8.0) には該当するが通常期基準 (>=10.0) には
    該当しない。修正前は両方が適用されて caution になっていた。
    """
    returns = [
        _FakeResult(rows=_seasonal_thresholds()),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=9.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "go"
    assert REASON_ALL_CLEAR in body["reason"]

    snapshot = body["thresholds_snapshot"]
    assert snapshot["evaluated"] == 1        # 通常期基準の 1 件だけを評価した
    assert snapshot["rules"] == []           # 発火したルールは無い
    assert len(snapshot["out_of_effect"]) == 1
    assert snapshot["out_of_effect"][0]["value"] == 8.0
    # 監査から有効期間そのものを読めなければ、除外が妥当だったか検証できない。
    assert snapshot["out_of_effect"][0]["active_from"] == "2025-12-01"
    assert snapshot["out_of_effect"][0]["active_to"] == "2026-03-31"


def test_expired_threshold_still_fires_inside_its_own_period():
    """同じ設定でも、施工時間帯が冬季なら冬季基準が効く。

    有効期間の比較対象が `datetime.now()` ではなく **判定対象の施工時間帯**
    であることの担保。now() で比較する実装は、来月・先月の施工計画を
    今日の基準で判定してしまい、このテストが落ちる。
    """
    returns = [
        _FakeResult(rows=_seasonal_thresholds()),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=9.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-02-10T00:00:00Z",
        target_window_end="2026-02-10T08:00:00Z",
    ))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "caution"
    assert "wind_speed_ms=9.0" in body["reason"]

    snapshot = body["thresholds_snapshot"]
    assert snapshot["evaluated"] == 1
    assert len(snapshot["rules"]) == 1
    assert snapshot["rules"][0]["value"] == 8.0          # 冬季基準が発火
    assert len(snapshot["out_of_effect"]) == 1
    assert snapshot["out_of_effect"][0]["value"] == 10.0  # 通常期基準が対象外


def test_all_thresholds_out_of_effect_degrades_to_caution():
    """全ルールが期間外なら「未設定」ではなく「有効期間外」として caution。

    判定根拠がゼロである以上 go とは言えない（PR-D の fail-safe 原則）。
    ただし案内文を「しきい値を設定してください」にすると、担当者は既存設定に
    気づかず重複登録する。原因の異なる 2 状態を区別する。
    """
    returns = [
        _FakeResult(rows=[_fake_threshold(
            "wind_speed_ms", ">=", 8.0, "warn",
            active_from=date(2025, 12, 1), active_to=date(2026, 3, 31),
        )]),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=1.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "caution"
    assert "有効期間外" in body["reason"]
    assert "1 件も設定されていません" not in body["reason"]
    assert REASON_ALL_CLEAR not in body["reason"]
    assert body["thresholds_snapshot"]["evaluated"] == 0
    assert len(body["thresholds_snapshot"]["out_of_effect"]) == 1


def test_out_of_effect_snapshot_is_jsonb_safe():
    """JSONB 列へ `date` オブジェクトが漏れない。

    `thresholds_snapshot` は JSONB 列で、`date` は json 直列化できないため
    asyncpg が実行時に落ちる。レスポンス JSON では FastAPI が `date` も
    文字列へ直してしまい検出できないので、`db.add()` された値そのものを見る。
    """
    returns = [
        _FakeResult(rows=_seasonal_thresholds()),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=9.0)]),
        _FakeResult(),
    ]
    db = _CapturingDB(returns)
    r = TestClient(_make_app(db)).post("/decisions", json=_payload())
    assert r.status_code == 200

    snapshots = [o.thresholds_snapshot for o in db.added
                 if hasattr(o, "thresholds_snapshot")]
    assert len(snapshots) == 1
    # date が残っていれば TypeError: Object of type date is not JSON serializable
    assert json.loads(json.dumps(snapshots[0])) == snapshots[0]

    # 監査ログ側にも同じ値が載る。こちらも JSONB 列。
    details = [o.detail for o in db.added if hasattr(o, "detail")]
    assert len(details) == 1
    assert json.loads(json.dumps(details[0])) == details[0]
    assert len(details[0]["out_of_effect_rules"]) == 1


def test_thresholds_without_active_period_are_unaffected():
    """有効期間 NULL のしきい値は従来どおり常に適用される。

    `db/migrations/0002_seed_demo.sql` の INSERT は両列を指定しないため、
    既定のしきい値は全行 NULL である。ここが変わると、有効期間を設定して
    いない全現場のしきい値が一斉に無効化される。
    """
    returns = [
        _FakeResult(rows=[_fake_threshold("wind_speed_ms", ">=", 10.0, "warn")]),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=15.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "caution"
    assert body["thresholds_snapshot"]["evaluated"] == 1
    assert body["thresholds_snapshot"]["out_of_effect"] == []


# ---------------------------------------------------------------------------
# 施工時間帯の timezone 正規化（naive = UTC）
# ---------------------------------------------------------------------------

def test_naive_window_start_does_not_500():
    """`target_window_start` が naive でも 500 にならない。

    `DecisionRequest.target_window_*` は素の `datetime` 型で timezone 無しの
    日時も受理する。片側だけ naive だと `window_end <= window_start` の比較が
    `TypeError: can't compare offset-naive and offset-aware datetimes` を投げ、
    未捕捉のまま 500 になる（初回 commit 95a64d5 から存在した不具合）。
    """
    c = TestClient(_make_app(_FakeDB(_empty_3())), raise_server_exceptions=False)
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-05-27T06:00:00",      # naive
        target_window_end="2026-05-27T18:00:00Z",       # aware
    ))
    assert r.status_code == 200


def test_naive_window_end_does_not_500():
    """`target_window_end` が naive でも 500 にならない（上の逆パターン）。"""
    c = TestClient(_make_app(_FakeDB(_empty_3())), raise_server_exceptions=False)
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-05-27T06:00:00Z",     # aware
        target_window_end="2026-05-27T18:00:00",        # naive
    ))
    assert r.status_code == 200


def test_naive_window_reversed_still_returns_400():
    """両方 naive でも逆転した時間帯は 400 のまま（正規化で判定が緩まない）。"""
    c = TestClient(_make_app(_FakeDB()), raise_server_exceptions=False)
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-05-27T18:00:00",
        target_window_end="2026-05-27T06:00:00",
    ))
    assert r.status_code == 400


def test_naive_window_is_normalized_before_persistence_and_audit():
    """naive な施工時間帯は永続化・監査ログの手前で aware になっている。

    正規化を判定経路だけに効かせて永続化と監査ログを素通しにすると、監査記録に
    オフセットの無い `"2026-05-27T06:00:00"` が残り、判定時刻が一意に決まらなく
    なる。監査ログは判定の再構成が目的なので、これでは記録として成立しない。
    """
    db = _CapturingDB(_empty_3())
    r = TestClient(_make_app(db)).post("/decisions", json=_payload(
        target_window_start="2026-05-27T06:00:00",
        target_window_end="2026-05-27T18:00:00",
    ))
    assert r.status_code == 200

    decisions = [o for o in db.added if hasattr(o, "target_window_start")]
    assert len(decisions) == 1
    # timestamptz 列へ naive を渡すと、解釈がセッションの TimeZone 設定に
    # 依存してしまう。ここで aware であることを保証する。
    assert decisions[0].target_window_start.tzinfo is not None
    assert decisions[0].target_window_end.tzinfo is not None
    assert decisions[0].target_window_start == datetime(2026, 5, 27, 6, 0, tzinfo=timezone.utc)

    details = [o.detail for o in db.added if hasattr(o, "detail")]
    assert len(details) == 1
    assert details[0]["window"]["start"] == "2026-05-27T06:00:00+00:00"
    assert details[0]["window"]["end"] == "2026-05-27T18:00:00+00:00"


def test_naive_window_is_interpreted_as_utc_at_the_jst_boundary():
    """naive は UTC 解釈である（JST 解釈ではない）ことを判定結果で示す。

    naive `2026-03-31T16:00:00` は
      - UTC 解釈 → JST 2026-04-01 → 冬季基準 (〜3/31) は失効
      - JST 解釈 → JST 2026-03-31 → 冬季基準は有効
    と判定が反転する。前者を採るのは、この値が timestamptz 列へも入り観測値の
    検索にも使われるため、保存側と解釈を揃える必要があるから。
    """
    returns = [
        _FakeResult(rows=_seasonal_thresholds()),
        _FakeResult(rows=[_fake_weather(wind_speed_ms=9.0)]),
        _FakeResult(),
    ]
    c = TestClient(_make_app(_FakeDB(returns)))
    r = c.post("/decisions", json=_payload(
        target_window_start="2026-03-31T16:00:00",      # naive → JST 4/1 01:00
        target_window_end="2026-03-31T21:00:00",        # naive → JST 4/1 06:00
    ))
    assert r.status_code == 200
    body = r.json()
    # JST 解釈なら冬季基準 (>=8.0) が発火して caution になる。
    assert body["status"] == "go"
    assert [x["value"] for x in body["thresholds_snapshot"]["out_of_effect"]] == [8.0]
