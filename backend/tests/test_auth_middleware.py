"""Unit tests for APIKeyMiddleware in isolation (no DB required)."""

from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import config as config_mod
from app.core import security as security_mod
from app.core.security import APIKeyMiddleware


@pytest.fixture
def make_app(monkeypatch):
    def _build(keys: list[str]) -> FastAPI:
        fake = config_mod.Settings(api_keys_raw=",".join(keys))
        monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
        monkeypatch.setattr(security_mod, "_config", config_mod)

        app = FastAPI()
        app.add_middleware(APIKeyMiddleware)

        @app.get("/r")
        async def r():
            return {"ok": True}

        @app.post("/w")
        async def w():
            return {"ok": True}

        @app.get("/healthz")
        async def hz():
            return {"ok": True}

        return app

    return _build


def test_disabled_when_keys_empty(make_app):
    c = TestClient(make_app([]))
    assert c.post("/w").status_code == 200
    assert c.get("/r").status_code == 200


def test_reads_pass_without_key(make_app):
    assert TestClient(make_app(["secret"])).get("/r").status_code == 200


def test_writes_blocked_without_key(make_app):
    r = TestClient(make_app(["secret"])).post("/w")
    assert r.status_code == 401
    assert "X-API-Key" in r.json()["detail"]


def test_writes_blocked_with_wrong_key(make_app):
    r = TestClient(make_app(["secret"])).post("/w", headers={"X-API-Key": "wrong"})
    assert r.status_code == 401


def test_writes_accepted_with_valid_key(make_app):
    app = make_app(["secret", "alt"])
    for k in ("secret", "alt"):
        r = TestClient(app).post("/w", headers={"X-API-Key": k})
        assert r.status_code == 200, f"key={k}"


def test_exempt_paths_bypass_auth(make_app):
    assert TestClient(make_app(["secret"])).get("/healthz").status_code == 200


def test_root_exempt_does_not_bypass_other_paths(monkeypatch):
    # Regression: if someone re-adds "/" to auth_exempt_paths, ensure the
    # prefix logic does NOT make every URL auth-free.
    fake = config_mod.Settings(api_keys_raw="secret", auth_exempt_paths=["/", "/healthz"])
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(security_mod, "_config", config_mod)

    app = FastAPI()
    app.add_middleware(APIKeyMiddleware)

    @app.post("/w")
    async def w():
        return {"ok": True}

    assert TestClient(app).post("/w").status_code == 401


def test_key_matches_non_ascii_rejected_cleanly():
    # Regression: hmac.compare_digest raises TypeError on str with non-ASCII.
    # _key_matches must encode to bytes and return False, not propagate.
    assert security_mod._key_matches("鍵", ["secret"]) is False


def test_key_matches_oversize_rejected():
    # CPU-amplification guard: bound the bytes passed to compare_digest.
    assert security_mod._key_matches("a" * 10_000, ["secret"]) is False


def test_oversize_key_via_http_rejected(make_app):
    big = "a" * 10_000
    r = TestClient(make_app(["secret"])).post("/w", headers={"X-API-Key": big})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Loop 37 — security pivot: HTTP method matrix + actor_from + rotation edges
# ---------------------------------------------------------------------------


@pytest.fixture
def make_mutations_app(monkeypatch):
    """App exposing PUT/PATCH/DELETE so we can verify auth covers all writes."""

    def _build(keys: list[str]) -> FastAPI:
        fake = config_mod.Settings(api_keys_raw=",".join(keys))
        monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
        monkeypatch.setattr(security_mod, "_config", config_mod)

        app = FastAPI()
        app.add_middleware(APIKeyMiddleware)

        @app.put("/w")
        async def put_w():
            return {"ok": True}

        @app.patch("/w")
        async def patch_w():
            return {"ok": True}

        @app.delete("/w")
        async def delete_w():
            return {"ok": True}

        return app

    return _build


def test_put_blocked_without_key(make_mutations_app):
    assert TestClient(make_mutations_app(["secret"])).put("/w").status_code == 401


def test_patch_blocked_without_key(make_mutations_app):
    assert TestClient(make_mutations_app(["secret"])).patch("/w").status_code == 401


def test_delete_blocked_without_key(make_mutations_app):
    assert TestClient(make_mutations_app(["secret"])).delete("/w").status_code == 401


def test_put_patch_delete_accepted_with_valid_key(make_mutations_app):
    c = TestClient(make_mutations_app(["secret"]))
    h = {"X-API-Key": "secret"}
    assert c.put("/w", headers=h).status_code == 200
    assert c.patch("/w", headers=h).status_code == 200
    assert c.delete("/w", headers=h).status_code == 200


def test_key_rotation_old_and_new_both_work(make_app):
    """During rotation, both keys are valid simultaneously — order irrelevant."""
    app = make_app(["old", "new"])
    for k in ("old", "new"):
        assert TestClient(app).post("/w", headers={"X-API-Key": k}).status_code == 200


def test_key_match_is_order_independent(make_app):
    """Reverse order — same security posture regardless of list ordering."""
    app = make_app(["new", "old"])
    for k in ("old", "new"):
        assert TestClient(app).post("/w", headers={"X-API-Key": k}).status_code == 200


def test_key_matches_empty_allowed_list_returns_false():
    assert security_mod._key_matches("anything", []) is False


def test_key_matches_empty_presented_returns_false():
    assert security_mod._key_matches("", ["secret"]) is False


# --- actor_from -------------------------------------------------------------


def _req_with(headers: dict[str, str] | None = None, method: str = "POST", path: str = "/w"):
    """Build a minimal Starlette Request for actor_from() input."""
    from starlette.requests import Request as StarletteRequest

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    }
    return StarletteRequest(scope)


def test_actor_from_honors_x_actor():
    assert security_mod.actor_from(_req_with({"X-Actor": "kensan"})) == "kensan"


def test_actor_from_missing_returns_anonymous(caplog):
    caplog.set_level("WARNING")
    assert security_mod.actor_from(_req_with({})) == "anonymous"
    assert any("missing X-Actor" in r.message for r in caplog.records)


def test_actor_from_blank_treated_as_missing():
    assert security_mod.actor_from(_req_with({"X-Actor": "   "})) == "anonymous"


def test_actor_from_trims_to_64_chars():
    long_actor = "a" * 200
    out = security_mod.actor_from(_req_with({"X-Actor": long_actor}))
    assert len(out) == 64
    assert out == "a" * 64


def test_actor_from_does_not_fall_back_to_api_key():
    """Credential leak guard: X-API-Key MUST NOT be used as audit actor."""
    out = security_mod.actor_from(_req_with({"X-API-Key": "supersecret"}))
    assert out == "anonymous"
    assert "supersecret" not in out


# ---------------------------------------------------------------------------
# Loop 48 — security pivot: boundary cases + path-prefix edge cases
# ---------------------------------------------------------------------------


def test_whitespace_padded_key_rejected(make_app):
    # Keys must match exactly. Silent trimming would allow " secret " to bypass
    # authentication where "secret" is the configured key — a silent mismatch
    # caused by client-side formatting bugs.
    r = TestClient(make_app(["secret"])).post("/w", headers={"X-API-Key": " secret "})
    assert r.status_code == 401


def test_key_exactly_max_len_is_processed_not_size_rejected(make_app):
    # _MAX_KEY_LEN=512: `len > 512` is the guard, so a 512-char key passes the
    # size guard and reaches hmac.compare_digest (where it correctly fails to
    # match "secret"). Confirms the boundary is inclusive, not off-by-one.
    assert (
        TestClient(make_app(["secret"])).post("/w", headers={"X-API-Key": "a" * 512}).status_code
        == 401
    )


def test_key_one_over_max_len_early_rejected():
    # 513 chars exceeds _MAX_KEY_LEN — guard fires before any hmac work.
    assert security_mod._key_matches("a" * 513, ["secret"]) is False


def test_exempt_subpath_is_also_exempt(make_app):
    # /healthz is in auth_exempt_paths. A subpath /healthz/sub should also
    # be exempt via the prefix match ("/healthz/" prefix). The middleware
    # calls call_next which returns 404 (no route) rather than a 401.
    r = TestClient(make_app(["secret"])).post("/healthz/sub")
    assert r.status_code == 404  # allowed through middleware, no route registered


def test_exempt_prefix_does_not_bleed_to_adjacent_path(make_app):
    # /healthzother starts with "/healthz" but NOT with "/healthz/" — the
    # prefix check must not exempt it. A POST without a key must still get 401.
    r = TestClient(make_app(["secret"])).post("/healthzother")
    assert r.status_code == 401


def test_key_matches_bytes_returns_false():
    # bytes has no .encode() → AttributeError caught at security.py:55-56.
    # Callers are expected to pass str, but HTTP parsing could yield bytes.
    assert security_mod._key_matches(b"secret", ["secret"]) is False  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# auth_required_methods: 文字列 `in` ではなくパース済みリストで判定すること
#
# 以前の実装は raw 設定文字列に対して `request.method.upper() not in
# s.auth_required_methods` と書いていた。`auth_required_methods` は
# "POST,PATCH,PUT,DELETE" という 1 本の文字列なので、この `in` は集合の所属
# 判定ではなく**部分文字列判定**になる。既定値では偶然すべて正しく動くため、
# 設定を変えた瞬間まで誰も気付かない類のバグである。
#
# 壊れ方は 2 方向あり、危険度が違う:
#   - 大文字小文字: 設定を小文字で書くと一致しなくなり、認証が丸ごと外れる
#     (fail-open)。これが本当に危ない方。
#   - 部分文字列: 設定値の一部に一致する別メソッドまで認証必須になる
#     (fail-closed)。安全側だが、原因不明の 401 として運用を止める。
# 両方向を固定する。
# ---------------------------------------------------------------------------


@pytest.fixture
def make_methods_app(monkeypatch):
    """`auth_required_methods` を差し替えられるアプリ。同一パスに全メソッドを生やす。"""

    def _build(auth_required_methods: str) -> FastAPI:
        fake = config_mod.Settings(
            api_keys_raw="secret", auth_required_methods=auth_required_methods
        )
        monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
        monkeypatch.setattr(security_mod, "_config", config_mod)

        app = FastAPI()
        app.add_middleware(APIKeyMiddleware)

        @app.api_route("/w", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
        async def w():
            return {"ok": True}

        return app

    return _build


def test_lowercase_configured_method_still_requires_auth(make_methods_app):
    # fail-open 回帰ガード。運用者が設定を小文字で書いても認証は外れないこと。
    # 旧実装: "POST" not in "post,patch,put,delete" → True → 認証スキップ → 200。
    assert TestClient(make_methods_app("post,patch,put,delete")).post("/w").status_code == 401


def test_whitespace_padded_config_is_parsed(make_methods_app):
    # "POST, PATCH" のように空白を入れて書くのは自然な記法。_csv が strip する。
    assert TestClient(make_methods_app("POST, PATCH")).post("/w").status_code == 401


def test_method_only_substring_of_config_is_not_required(make_methods_app):
    # PROPPATCH は WebDAV (RFC 4918) の実在するメソッド。これだけを設定したとき、
    # 素の PATCH は設定されていないので認証不要でなければならない。
    # 旧実装: "PATCH" in "PROPPATCH" → True → 設定していない PATCH まで 401。
    assert TestClient(make_methods_app("PROPPATCH")).patch("/w").status_code == 200


def test_unconfigured_method_passes_without_key(make_methods_app):
    # 対照群: 設定に無いメソッドは素通りする、という本来の意味論。
    assert TestClient(make_methods_app("DELETE")).post("/w").status_code == 200
    assert TestClient(make_methods_app("DELETE")).delete("/w").status_code == 401


def test_auth_required_methods_list_normalizes_case_and_whitespace():
    # property 単体の契約。ミドルウェア経由の確認とは別に、正規化そのものを固定する。
    s = config_mod.Settings(auth_required_methods=" post , PATCH ,, put ")
    assert s.auth_required_methods_list == ["POST", "PATCH", "PUT"]
