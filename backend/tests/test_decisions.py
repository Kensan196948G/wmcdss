"""Unit tests for POST /decisions endpoint — no DB required."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.api.decisions import router
from app.db.session import get_db
from app.models.observations import WeatherObservation, MarineObservation
from app.models.threshold import Threshold

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


def _fake_threshold(metric: str, op: str, value: float, severity: str) -> Threshold:
    t = Threshold()
    t.work_type = "concrete"
    t.metric = metric
    t.op = op
    t.value = value
    t.severity = severity
    t.site_id = None
    t.note = None
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

def test_create_decision_go_when_no_thresholds():
    c = TestClient(_make_app(_FakeDB(_empty_3())))
    r = c.post("/decisions", json=_payload())
    assert r.status_code == 200
    assert r.json()["status"] == "go"
    assert r.json()["reason"] == "全しきい値を満たしています。施工可。"


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
    assert body["thresholds_snapshot"] == {"rules": []}
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
