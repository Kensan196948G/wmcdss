"""NOWPHAS service/job unit tests — no DB, no network required."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.services import nowphas as svc

STATION_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<NowphasWeb>
<PointSetup>
<point code="614" area="1" name="Kutsugata" lat="45.1872" lon="141.1419" />
<point code="602" area="1" name="Wakkanai" lat="45.4000" lon="141.7000" />
<point code="999" name="no-lat" />
</PointSetup>
</NowphasWeb>"""

MAP_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<DataMap time20min="202608122300">
  <mapdata code="614">
    <yugiha>0.55</yugiha><shiyuki>4.6</shiyuki><namimuki>E</namimuki>
    <zentai_wh>60</zentai_wh><fuha_wh>57</fuha_wh><uneri_wh>19</uneri_wh>
  </mapdata>
  <mapdata code="602">
    <yugiha>99999</yugiha><shiyuki>99999</shiyuki><namimuki></namimuki>
  </mapdata>
</DataMap>"""

TIDE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<DataMap datatime="202608122320">
  <mapdata code="614"><choui>17</choui><tenmon>14</tenmon><hensa>3</hensa></mapdata>
  <mapdata code="602"><choui>99999</choui></mapdata>
</DataMap>"""


def test_fetch_stations_parses_master():
    import httpx

    def handler(request):
        return httpx.Response(200, content=STATION_XML)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as ac:
            return await svc.fetch_stations(ac)

    stations = __import__("asyncio").run(run())
    codes = [s.code for s in stations]
    assert codes == ["614", "602"]
    assert stations[0].name == "Kutsugata"
    assert stations[0].lat == 45.1872


def test_parse_map_xml_values_and_missing():
    observed_at, by_code = svc._parse_map_xml(MAP_XML)
    assert observed_at == datetime(2026, 8, 12, 14, 0, tzinfo=timezone.utc)  # 23:00 JST = 14:00 UTC
    assert by_code["614"]["yugiha"] == "0.55"
    assert by_code["602"]["yugiha"] == "99999"


def test_num_and_compass():
    assert svc._num("0.55") == 0.55
    assert svc._num("99999") is None
    assert svc._num("") is None
    assert svc._num("abc") is None
    assert svc._num("nan") is None
    assert svc._compass_to_deg("E") == 90.0
    assert svc._compass_to_deg("NNE") == 22.5
    assert svc._compass_to_deg("") is None


def test_parse_tide_merge_cm_to_m():
    import httpx

    def handler(request):
        if "choui_mapxml" in request.url.path:
            return httpx.Response(200, content=TIDE_XML)
        return httpx.Response(200, content=MAP_XML)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as ac:
            _, samples = await svc.fetch_latest(ac)
            return samples

    samples = __import__("asyncio").run(run())
    s614 = samples["614"]
    assert s614.sig_wave_h_m == 0.55
    assert s614.wave_period_s == 4.6
    assert s614.wave_dir_deg == 90.0
    assert s614.tide_level_m == 0.17  # 17 cm → m
    s602 = samples["602"]
    assert s602.sig_wave_h_m is None  # 99999 → 欠測
    assert s602.tide_level_m is None


def test_nearest_station_and_max_km():
    stations = [
        svc.NowphasStation(code="A", name="A港", lat=35.0, lon=140.0),
        svc.NowphasStation(code="B", name="B港", lat=36.0, lon=141.0),
    ]
    near = svc.nearest_station(stations, 35.1, 140.1)
    assert near is not None and near.code == "A"
    far = svc.nearest_station(stations, 33.0, 137.0, max_km=100.0)
    assert far is None


def test_normalise_row_shape():
    sample = svc.NowphasSample(
        observed_at=datetime(2026, 8, 12, 14, 0, tzinfo=timezone.utc),
        sig_wave_h_m=0.55,
        wave_period_s=4.6,
        wave_dir_deg=90.0,
        tide_level_m=0.17,
    )
    row = svc.normalise(sample, str(uuid.uuid4()), station_code="614")
    assert row["source"] == "nowphas"
    assert row["station_code"] == "614"
    assert row["observed_at"].tzinfo is not None
    assert row["sig_wave_h_m"] == 0.55


# ---------------------------------------------------------------------------
# job.run_once（DB モック）
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, site_rows):
        self._site_rows = site_rows
        self.committed = False
        self.rolled_back = False
        self.added = []

    async def execute(self, stmt):
        return _FakeResult(self._site_rows)

    async def flush(self):
        pass

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def rollback(self):
        self.rolled_back = True

    def begin_nested(self):
        return _FakeBeginNested()


class _FakeBeginNested:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return False


class _FakeSessionCM:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *_):
        pass


def _fake_site(code="PORT-01", kind="marine"):
    from app.models.site import Site

    s = Site()
    s.id = uuid.uuid4()
    s.code = code
    s.kind = kind
    s.lat = 35.1
    s.lon = 140.1
    return s


def test_run_once_writes_nearest_station_row(monkeypatch):
    import app.jobs.ingest_nowphas as job

    site = _fake_site()
    db = _FakeSession([site])
    monkeypatch.setattr(job, "SessionLocal", lambda: _FakeSessionCM(db))

    stations = [svc.NowphasStation(code="A", name="A港", lat=35.0, lon=140.0)]
    samples = {
        "A": svc.NowphasSample(
            observed_at=datetime(2026, 8, 12, 14, 0, tzinfo=timezone.utc),
            sig_wave_h_m=0.55, wave_period_s=4.6, wave_dir_deg=90.0, tide_level_m=0.17,
        )
    }

    async def fake_fetch_stations(client):
        return stations

    async def fake_fetch_latest(client):
        return samples["A"].observed_at, samples

    monkeypatch.setattr(svc, "fetch_stations", fake_fetch_stations)
    monkeypatch.setattr(svc, "fetch_latest", fake_fetch_latest)

    import asyncio
    n = asyncio.run(job.run_once())
    assert n == 1
    assert db.committed


def test_run_once_no_marine_sites_audits(monkeypatch):
    import app.jobs.ingest_nowphas as job

    db = _FakeSession([])
    monkeypatch.setattr(job, "SessionLocal", lambda: _FakeSessionCM(db))
    import asyncio
    n = asyncio.run(job.run_once())
    assert n == 0
    assert db.committed
