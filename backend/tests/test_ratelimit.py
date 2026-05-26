"""Unit tests for RateLimitMiddleware in isolation (no DB required).

Mirrors test_auth_middleware.py — same monkeypatch shape for Settings so an
operator can read either suite without context switching.
"""
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import config as config_mod
from app.core import ratelimit as ratelimit_mod
from app.core.ratelimit import RateLimitMiddleware


@pytest.fixture(autouse=True)
def _reset_buckets():
    # Each test gets a clean slate. The module-level _buckets singleton is
    # intentional in production (process-wide quota), but for tests we want
    # isolation.
    ratelimit_mod._buckets.reset()
    yield
    ratelimit_mod._buckets.reset()


@pytest.fixture
def make_app(monkeypatch):
    def _build(**overrides) -> FastAPI:
        defaults = dict(rate_limit_per_minute=3)
        defaults.update(overrides)
        fake = config_mod.Settings(**defaults)
        monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
        monkeypatch.setattr(ratelimit_mod, "_config", config_mod)

        app = FastAPI()
        app.add_middleware(RateLimitMiddleware)

        @app.get("/r")
        async def r(): return {"ok": True}

        @app.post("/w")
        async def w(): return {"ok": True}

        @app.get("/healthz")
        async def hz(): return {"ok": True}

        @app.post("/healthz_w")  # to exercise exempt-path POST
        async def hz_w(): return {"ok": True}

        return app
    return _build


def test_disabled_when_limit_zero(make_app):
    c = TestClient(make_app(rate_limit_per_minute=0))
    for _ in range(10):
        assert c.post("/w").status_code == 200
    # And no rate-limit headers are added when disabled.
    assert "X-RateLimit-Limit" not in c.post("/w").headers


def test_under_limit_passes_with_headers(make_app):
    c = TestClient(make_app(rate_limit_per_minute=3))
    r = c.post("/w")
    assert r.status_code == 200
    assert r.headers["X-RateLimit-Limit"] == "3"
    assert r.headers["X-RateLimit-Remaining"] == "2"


def test_over_limit_rejected_with_429(make_app):
    c = TestClient(make_app(rate_limit_per_minute=2))
    assert c.post("/w").status_code == 200
    assert c.post("/w").status_code == 200
    blocked = c.post("/w")
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "rate limit exceeded"
    assert int(blocked.headers["Retry-After"]) >= 1
    assert blocked.headers["X-RateLimit-Remaining"] == "0"


def test_separate_api_keys_have_separate_buckets(make_app):
    c = TestClient(make_app(rate_limit_per_minute=2))
    # Identity is hash(X-API-Key) so different keys do not share quota.
    for _ in range(2):
        assert c.post("/w", headers={"X-API-Key": "alice"}).status_code == 200
    assert c.post("/w", headers={"X-API-Key": "alice"}).status_code == 429
    # Bob still has a full quota.
    assert c.post("/w", headers={"X-API-Key": "bob"}).status_code == 200


def test_reads_not_limited_by_default(make_app):
    c = TestClient(make_app(rate_limit_per_minute=1))
    for _ in range(5):
        assert c.get("/r").status_code == 200  # GET not in rate_limit_methods


def test_exempt_paths_never_429(make_app):
    c = TestClient(make_app(rate_limit_per_minute=1,
                            rate_limit_exempt_paths=["/healthz", "/healthz_w"]))
    # Burn the bucket on /w first.
    c.post("/w")
    c.post("/w")  # this one 429s — limit_per_minute=1
    # Exempt path POST still passes regardless.
    for _ in range(5):
        assert c.post("/healthz_w").status_code == 200


def test_window_expiry_restores_quota(make_app, monkeypatch):
    # Inject a controllable clock so we don't have to sleep 60s.
    now = {"t": 1000.0}
    monkeypatch.setattr(ratelimit_mod.time, "monotonic", lambda: now["t"])

    c = TestClient(make_app(rate_limit_per_minute=1))
    assert c.post("/w").status_code == 200
    assert c.post("/w").status_code == 429
    # Advance past the 60-s window.
    now["t"] += 61.0
    assert c.post("/w").status_code == 200


def test_oversize_api_key_header_is_handled(make_app):
    c = TestClient(make_app(rate_limit_per_minute=2))
    big = "a" * 10_000
    # Cap inside _identity prevents sha256 over a huge string. The request
    # still gets bucketed (not crashed).
    assert c.post("/w", headers={"X-API-Key": big}).status_code == 200
    assert c.post("/w", headers={"X-API-Key": big}).status_code == 200
    assert c.post("/w", headers={"X-API-Key": big}).status_code == 429


def test_identity_never_contains_raw_key():
    # Defense in depth: even if a future change logs `ident`, it must not be
    # possible to recover the raw key.
    class FakeReq:
        headers = {"X-API-Key": "super-secret-token"}
        client = None
    ident = ratelimit_mod._identity(FakeReq())
    assert "super-secret-token" not in ident
    assert ident.startswith("k:")
    assert len(ident) == 2 + 16  # "k:" + 16 hex chars


def test_ip_fallback_when_no_api_key():
    class FakeClient:
        host = "203.0.113.7"
    class FakeReq:
        headers = {}
        client = FakeClient()
    assert ratelimit_mod._identity(FakeReq()) == "i:203.0.113.7"


# ---------------------------------------------------------------------------
# FIFO eviction at the identity layer — protects against the X-API-Key
# rotation DoS where an attacker spins up unbounded distinct identities to
# exhaust memory. We shrink _MAX_IDENTITIES to 3 so the tests stay fast
# while still exercising the exact branch at ratelimit.py:60-62.
# ---------------------------------------------------------------------------

def test_identity_cap_at_capacity_keeps_all(monkeypatch):
    monkeypatch.setattr(ratelimit_mod, "_MAX_IDENTITIES", 3)
    b = ratelimit_mod._Buckets()
    for i in range(3):
        b.hit(f"k:{i}", limit=10, window_s=60.0, now=1000.0 + i)
    assert set(b._store.keys()) == {"k:0", "k:1", "k:2"}


def test_identity_cap_evicts_oldest_when_full(monkeypatch):
    monkeypatch.setattr(ratelimit_mod, "_MAX_IDENTITIES", 3)
    b = ratelimit_mod._Buckets()
    for i in range(3):
        b.hit(f"k:{i}", limit=10, window_s=60.0, now=1000.0 + i)
    b.hit("k:new", limit=10, window_s=60.0, now=2000.0)
    # k:0 is the oldest insertion → must be evicted; k:new must be present.
    assert "k:0" not in b._store
    assert "k:new" in b._store
    assert set(b._store.keys()) == {"k:1", "k:2", "k:new"}


def test_evicted_identity_starts_fresh_quota(monkeypatch):
    # If an attacker rotates X-API-Key faster than the cap, an evicted
    # identity coming back must get a clean deque — never inherit timestamps.
    monkeypatch.setattr(ratelimit_mod, "_MAX_IDENTITIES", 2)
    b = ratelimit_mod._Buckets()
    # Burn k:victim under a tight limit.
    for _ in range(3):
        b.hit("k:victim", limit=3, window_s=60.0, now=1000.0)
    assert len(b._store["k:victim"]) == 3
    # Evict k:victim by overflowing with 2 new identities.
    b.hit("k:a", limit=3, window_s=60.0, now=1001.0)
    b.hit("k:b", limit=3, window_s=60.0, now=1002.0)
    assert "k:victim" not in b._store
    # k:victim returns — its bucket must be brand new (1 hit, not 4).
    allowed, remaining, _ = b.hit("k:victim", limit=3, window_s=60.0, now=1003.0)
    assert allowed is True
    assert remaining == 2  # limit 3 − 1 fresh hit
