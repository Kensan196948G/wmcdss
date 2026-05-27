"""Unit tests for observations endpoints — no DB required."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.observations import router
from app.db.session import get_db
from app.models.observations import WeatherObservation, MarineObservation


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

    def scalar_one_or_none(self):
        return self._scalar

    def fetchall(self):
        return self._rows


class _FakeDB:
    def __init__(self, execute_return=None):
        self._execute_return = execute_return or _FakeResult()

    async def execute(self, stmt):
        return self._execute_return

    def add(self, obj):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass


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
_NOW = datetime(2026, 5, 27, 9, 0, 0, tzinfo=timezone.utc)


def _fake_weather() -> WeatherObservation:
    obs = WeatherObservation()
    obs.id = 1
    obs.site_id = SITE_ID
    obs.observed_at = _NOW
    obs.temperature_c = 25.0
    obs.humidity_pct = 60.0
    obs.pressure_hpa = 1013.0
    obs.precip_mm = 0.0
    obs.wind_speed_ms = 5.0
    obs.wind_gust_ms = 8.0
    obs.wind_dir_deg = 180.0
    obs.sunshine_h = 6.0
    obs.data_version = 1
    obs.source = "jma"
    obs.fetched_at = _NOW
    return obs


def _fake_marine() -> MarineObservation:
    obs = MarineObservation()
    obs.id = 2
    obs.site_id = SITE_ID
    obs.observed_at = _NOW
    obs.sig_wave_h_m = 1.5
    obs.wave_period_s = 8.0
    obs.wave_dir_deg = 270.0
    obs.tide_level_m = 0.3
    obs.current_speed_ms = 0.5
    obs.current_dir_deg = 90.0
    obs.data_version = 1
    obs.source = "jma_wave"
    obs.fetched_at = _NOW
    return obs


# ---------------------------------------------------------------------------
# Weather GET tests
# ---------------------------------------------------------------------------

def test_list_weather_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get(f"/observations/weather?site_id={SITE_ID}")
    assert r.status_code == 200
    assert r.json() == []


def test_list_weather_returns_rows():
    obs = _fake_weather()
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[obs]))))
    r = c.get(f"/observations/weather?site_id={SITE_ID}")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["temperature_c"] == 25.0


def test_list_weather_limit_param_accepted():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get(f"/observations/weather?site_id={SITE_ID}&limit=50")
    assert r.status_code == 200


def test_list_weather_time_range_accepted():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get(
        f"/observations/weather?site_id={SITE_ID}"
        "&t0=2026-05-27T00:00:00Z&t1=2026-05-27T12:00:00Z"
    )
    assert r.status_code == 200


def test_latest_weather_404_when_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    r = c.get(f"/observations/weather/latest?site_id={SITE_ID}")
    assert r.status_code == 404


def test_latest_weather_200_when_present():
    obs = _fake_weather()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=obs))))
    r = c.get(f"/observations/weather/latest?site_id={SITE_ID}")
    assert r.status_code == 200
    assert r.json()["source"] == "jma"


# ---------------------------------------------------------------------------
# Marine GET tests
# ---------------------------------------------------------------------------

def test_list_marine_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(rows=[]))))
    r = c.get(f"/observations/marine?site_id={SITE_ID}")
    assert r.status_code == 200
    assert r.json() == []


def test_latest_marine_404_when_empty():
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=None))))
    r = c.get(f"/observations/marine/latest?site_id={SITE_ID}")
    assert r.status_code == 404


def test_latest_marine_200_when_present():
    obs = _fake_marine()
    c = TestClient(_make_app(_FakeDB(_FakeResult(scalar=obs))))
    r = c.get(f"/observations/marine/latest?site_id={SITE_ID}")
    assert r.status_code == 200
    assert r.json()["sig_wave_h_m"] == 1.5


# ---------------------------------------------------------------------------
# Ingest POST tests
# ---------------------------------------------------------------------------

def test_ingest_weather_empty_payload():
    c = TestClient(_make_app(_FakeDB()))
    r = c.post("/observations/weather", json=[])
    assert r.status_code == 201
    body = r.json()
    assert body["inserted"] == 0
    assert body["total"] == 0


def test_ingest_weather_one_row():
    fake_result = _FakeResult(rows=[("row-id", _NOW, SITE_ID)])
    c = TestClient(_make_app(_FakeDB(fake_result)))
    payload = [{
        "site_id": str(SITE_ID),
        "observed_at": _NOW.isoformat(),
        "temperature_c": 20.0,
        "data_version": 1,
        "source": "jma",
    }]
    r = c.post("/observations/weather", json=payload)
    assert r.status_code == 201
    assert r.json()["inserted"] == 1
    assert r.json()["total"] == 1


def test_ingest_marine_empty_payload():
    c = TestClient(_make_app(_FakeDB()))
    r = c.post("/observations/marine", json=[])
    assert r.status_code == 201
    assert r.json()["inserted"] == 0


def test_ingest_marine_one_row():
    fake_result = _FakeResult(rows=[("row-id", _NOW, SITE_ID)])
    c = TestClient(_make_app(_FakeDB(fake_result)))
    payload = [{
        "site_id": str(SITE_ID),
        "observed_at": _NOW.isoformat(),
        "sig_wave_h_m": 2.0,
        "data_version": 1,
        "source": "jma_wave",
    }]
    r = c.post("/observations/marine", json=payload)
    assert r.status_code == 201
    assert r.json()["inserted"] == 1
