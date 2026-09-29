"""匿名リクエストの admin 昇格を禁止する fail-closed 不変条件テスト（task-1 / F1）。

## 背景（実測済みの脆弱性）

本システムの認証は 2 層ある。

  1. API キー層 (app/core/security.py APIKeyMiddleware)
  2. route 層 (app/api/auth.py の require_* 依存)

ところが route 層の 4 つの依存は、いずれも「Bearer ヘッダーが無い = API キー
middleware が照合済み」とみなして admin 相当 (``_api_key_holder()``) を返して
いた。APIKeyMiddleware は ``api_keys`` が空だと最初の分岐で丸ごと素通りするため、
公開 MVP (``WMCDSS_API_KEYS_RAW`` が空) では **Authorization ヘッダーを外すだけ**で
匿名リクエストが admin 相当になり、現場・閾値・判定の変更系 API が無認証で通って
いた（``POST /api/v1/sites`` body={} → 422、``DELETE /api/v1/thresholds/<uuid>``
→ 404 = 認可通過の実測値）。MVP の意図は「誰でも閲覧できる read-only デモ」で
あり、これは意図せぬ fail-open である。

## 修正の契約

- 資格情報なしのリクエストを admin 相当として扱うのは、**明示的な opt-in 設定
  (``WMCDSS_DEV_OPEN_ACCESS``、既定 false) が true のときだけ**。
- 4 依存すべてを同じ規則に統一する。1 つでも漏らすと別経路が残る:
  ``require_admin_or_api_key`` / ``require_hq_or_admin_or_api_key`` /
  ``require_any_user_or_api_key`` / ``require_machine_client``。
- Bearer 付きの経路（field/hq JWT のロール検査）のロジックは変えない。
  昇格させないことだけを固定する。
- API キーが設定された環境では、従来どおり APIKeyMiddleware が 401 で拒否する
  ため挙動は変わらない。有効な X-API-Key は route 層でも改めて照合する
  （middleware の免除パスに依存しないため）。

このファイルは「穴が実際に閉じているか」を HTTP 応答と依存の直接呼び出しの
両方で固定する。dev スタックの開発体験が壊れていないこと（フラグ true）も
同時に固定し、締め出し方向の過剰修正にも歯止めを置く。
"""

from __future__ import annotations

import importlib
import uuid
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import Headers
from starlette.requests import Request as StarletteRequest

import app.api.auth as api_auth_mod
import app.core.auth as core_auth_mod
from app.api.auth import (
    get_current_user_or_anon,
    require_admin_or_api_key,
    require_any_user_or_api_key,
    require_hq_or_admin_or_api_key,
    require_machine_client,
)
from app.core import config as config_mod
from app.core.config import Settings
from app.db.session import get_db

# HS256 は鍵長 32 文字以上を要求する（RFC 7518 §3.2）。ダミー値でも短い鍵を
# 使うと PyJWT が恒常的に警告を出し、本物の警告が埋もれる。
_TEST_SECRET = "test-secret-key-32chars-padding!!"

_THRESHOLD_ID = "00000000-0000-0000-0000-000000000000"


# ---------------------------------------------------------------------------
# ヘルパー
# ---------------------------------------------------------------------------


def _settings(**overrides) -> Settings:
    defaults: dict = dict(
        # この検査は「設定検証」ではなく認可の検査なので、起動時検査は降格する。
        allow_insecure_defaults=True,
        jwt_secret=_TEST_SECRET,
        api_keys_raw="",
        dev_open_access=False,
    )
    defaults.update(overrides)
    return Settings(**defaults)


class _UnusableDB:
    """触ったら落ちる番人。未認証リクエストが DB へ到達しないこと自体を固定する。"""

    def __getattr__(self, name):
        raise AssertionError(
            f"未認証リクエストが DB ({name}) へ到達した。認可依存が効いていない。"
        )


class _FakeResult:
    def scalars(self):
        return self

    def all(self):
        return []

    def fetchall(self):
        return []


class _NoopDB:
    """認可通過後の到達確認用。DB を触っても何も起きない。"""

    async def execute(self, stmt):
        return _FakeResult()

    def add(self, obj):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass

    async def delete(self, obj):
        pass


@contextmanager
def _client(monkeypatch, fake: Settings, db=None):
    """fake 設定で app.main を組み立て直した TestClient。

    route の依存 (``app.api.auth``) と JWT 発行・検証 (``app.core.auth``) は
    モジュールグローバルの ``get_settings`` を参照するため、両方を差し替える。
    middleware は config モジュール経由で参照するので config 側も差し替える。
    """
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(core_auth_mod, "get_settings", lambda: fake)

    import app.main as main_mod

    importlib.reload(main_mod)

    async def _override():
        yield db if db is not None else _UnusableDB()

    main_mod.app.dependency_overrides[get_db] = _override
    try:
        with TestClient(main_mod.app, raise_server_exceptions=False) as c:
            yield c
    finally:
        # 他テストへ設定差し替え済みの app を残さない。
        importlib.reload(main_mod)


def _request(headers: dict[str, str] | None = None) -> StarletteRequest:
    """依存を直接呼ぶための最小 Request。"""
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "raw_path": b"/x",
        "query_string": b"",
        "headers": Headers(headers or {}).raw,
    }
    return StarletteRequest(scope)


# ===========================================================================
# 1. フラグ false（既定）: 資格情報なしの変更系リクエストは拒否される
# ===========================================================================


def test_anonymous_post_sites_is_denied_when_flag_off(monkeypatch):
    """匿名 POST /api/v1/sites は 401/403。422（=認可通過）になってはならない。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.post("/api/v1/sites", json={})
    assert r.status_code in (401, 403), (
        f"匿名 POST /api/v1/sites が {r.status_code} を返した。"
        "422 はボディ検証まで到達した = 認可を通過した証拠であり、"
        "公開 URL から第三者が現場を作成できてしまう。"
    )


def test_anonymous_delete_threshold_is_denied_when_flag_off(monkeypatch):
    """匿名 DELETE /api/v1/thresholds/{id} は 401/403。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.delete(f"/api/v1/thresholds/{_THRESHOLD_ID}")
    assert r.status_code in (401, 403), (
        f"匿名 DELETE /api/v1/thresholds/{{id}} が {r.status_code} を返した。"
        "404 は認可を通過して DB を引いた証拠であり、無認証の削除経路が残っている。"
    )


def test_anonymous_post_etl_run_is_denied_when_flag_off(monkeypatch):
    """匿名 POST /api/v1/etl/run/{job} は 401/403。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.post("/api/v1/etl/run/1", json={})
    assert r.status_code in (401, 403), f"匿名 ETL 実行が {r.status_code} を返した。"


def test_anonymous_post_decisions_is_denied_when_flag_off(monkeypatch):
    """匿名 POST /api/v1/decisions は 401/403（require_any_user_or_api_key も統一）。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.post("/api/v1/decisions", json={})
    assert r.status_code in (401, 403), (
        f"匿名 POST /api/v1/decisions が {r.status_code} を返した。"
        "422 は認可通過の証拠。require_any_user_or_api_key が fail-open のまま。"
    )


@pytest.mark.parametrize("kind", ["weather", "marine"])
def test_anonymous_observation_ingest_is_denied_when_flag_off(monkeypatch, kind):
    """匿名 POST /api/v1/observations/{kind} は 403。

    観測値の投入は API キー専用 (require_machine_client) であり、匿名で通ると
    第三者が任意の観測値を偽装投入でき、施工判断 (go/caution/stop) を
    外部から操作できてしまう。
    """
    with _client(monkeypatch, _settings()) as c:
        r = c.post(f"/api/v1/observations/{kind}", json={})
    assert r.status_code == 403, (
        f"匿名 POST /api/v1/observations/{kind} が {r.status_code} を返した"
        "（期待は 403）。422 は認可を通過した証拠。"
    )


def test_anonymous_bogus_api_key_is_denied_when_flag_off(monkeypatch):
    """api_keys 未設定でも、でたらめな X-API-Key で admin になれないこと。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.post("/api/v1/sites", json={}, headers={"X-API-Key": "guessed"})
    assert r.status_code in (401, 403), f"不正キーで {r.status_code} になった。"


# ===========================================================================
# 2. 依存の直接呼び出し: 4 依存すべてが同じ規則であること
# ===========================================================================


@pytest.mark.parametrize(
    "dep",
    [
        require_admin_or_api_key,
        require_hq_or_admin_or_api_key,
        require_any_user_or_api_key,
        require_machine_client,
    ],
    ids=["admin", "hq", "any", "machine"],
)
def test_all_credential_less_deps_reject_when_flag_off(monkeypatch, dep):
    """資格情報なし + フラグ false → 例外（401/403）。4 依存すべてで統一。"""
    from fastapi import HTTPException

    fake = _settings()
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    # require_machine_client は API キー専用で Bearer を受け取らない。
    kwargs = {} if dep is require_machine_client else {"credentials": None}

    with pytest.raises(HTTPException) as ei:
        dep(request=_request(), **kwargs)
    assert ei.value.status_code in (401, 403), (
        f"{dep.__name__} が {ei.value.status_code} を返した。401/403 で拒否すること。"
    )


def test_machine_client_accepts_valid_api_key(monkeypatch):
    """API キー設定時、require_machine_client は有効な鍵で通ること。"""
    fake = _settings(api_keys_raw="s3cret-key")
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    assert require_machine_client(request=_request({"X-API-Key": "s3cret-key"})) is None


def test_machine_client_rejects_invalid_api_key(monkeypatch):
    """API キー設定時、require_machine_client は不正な鍵を 403 で拒否すること。"""
    from fastapi import HTTPException

    fake = _settings(api_keys_raw="s3cret-key")
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    with pytest.raises(HTTPException) as ei:
        require_machine_client(request=_request({"X-API-Key": "wrong"}))
    assert ei.value.status_code == 403


@pytest.mark.parametrize(
    "dep",
    [
        require_admin_or_api_key,
        require_hq_or_admin_or_api_key,
        require_any_user_or_api_key,
    ],
    ids=["admin", "hq", "any"],
)
def test_valid_api_key_is_accepted_by_deps(monkeypatch, dep):
    """API キーが設定されていれば、有効な X-API-Key は route 層でも通ること。

    middleware の免除パスでは middleware の照合が働かないため、依存自身が
    照合できないと「middleware が通したから安全」という前提に依存してしまう。
    """
    fake = _settings(api_keys_raw="s3cret-key")
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    user = dep(credentials=None, request=_request({"X-API-Key": "s3cret-key"}))
    assert user.role == "admin"


def test_anonymous_read_identity_is_not_admin_when_flag_off(monkeypatch):
    """公開 read-only 経路は匿名でも通すが、admin 相当は返さないこと。

    ``get_current_user_or_anon`` は GET 用で、MVP の read-only デモを成立させる
    ために認証は要求しない。ただし返した role を将来の route が認可に使った
    瞬間に昇格経路になるため、admin 以外を返す。
    """
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: _settings())
    user = get_current_user_or_anon(credentials=None, request=_request())
    assert user.role != "admin"


# ===========================================================================
# 3. フラグ true（開発スタック）: 従来の開発体験が壊れていないこと
# ===========================================================================


def test_dev_open_access_keeps_anonymous_sites_reachable(monkeypatch):
    """フラグ true なら匿名でも到達できる（ボディ検証の 422 まで進む）。"""
    with _client(monkeypatch, _settings(dev_open_access=True)) as c:
        r = c.post("/api/v1/sites", json={})
    assert r.status_code == 422, (
        f"フラグ true で匿名 POST /api/v1/sites が {r.status_code}。"
        "開発スタックの利便性（認可通過後にボディ検証へ進む）が壊れている。"
    )


@pytest.mark.parametrize("kind", ["weather", "marine"])
def test_dev_open_access_keeps_observation_ingest_reachable(monkeypatch, kind):
    """フラグ true なら API キーなしの機械連携（開発・ローカル検証）が通ること。"""
    with _client(monkeypatch, _settings(dev_open_access=True), db=_NoopDB()) as c:
        r = c.post(f"/api/v1/observations/{kind}", json=[])
    assert r.status_code == 201, (
        f"フラグ true で匿名 POST /api/v1/observations/{kind} が {r.status_code}。"
        "開発時の取り込み検証ができなくなっている。"
    )


def test_dev_open_access_keeps_anonymous_decisions_reachable(monkeypatch):
    """フラグ true なら匿名の判定記録も従来どおり到達できること。"""
    with _client(monkeypatch, _settings(dev_open_access=True)) as c:
        r = c.post("/api/v1/decisions", json={})
    assert r.status_code == 422, (
        f"フラグ true で匿名 POST /api/v1/decisions が {r.status_code}。"
    )


# ===========================================================================
# 4. API キー設定時（本番相当）: 従来どおりの挙動
# ===========================================================================


def test_valid_api_key_reaches_mutation_when_keys_configured(monkeypatch):
    """有効な X-API-Key は到達できる（=認可通過。空ボディの 422 で判定）。"""
    with _client(monkeypatch, _settings(api_keys_raw="prod-key-1")) as c:
        r = c.post("/api/v1/sites", json={}, headers={"X-API-Key": "prod-key-1"})
    assert r.status_code == 422, (
        f"有効な API キーで {r.status_code}。本番の機械連携経路が壊れている。"
    )


def test_invalid_api_key_is_rejected_when_keys_configured(monkeypatch):
    """不正な X-API-Key は 401（従来どおり middleware が拒否）。"""
    with _client(monkeypatch, _settings(api_keys_raw="prod-key-1")) as c:
        r = c.post("/api/v1/sites", json={}, headers={"X-API-Key": "wrong"})
    assert r.status_code == 401, f"不正な API キーで {r.status_code}。"


def test_anonymous_mutation_is_rejected_when_keys_configured(monkeypatch):
    """API キー設定時の匿名変更系は従来どおり 401。"""
    with _client(monkeypatch, _settings(api_keys_raw="prod-key-1")) as c:
        r = c.post("/api/v1/sites", json={})
    assert r.status_code == 401, f"API キー設定下の匿名変更系が {r.status_code}。"


# ===========================================================================
# 5. Bearer 付き経路: 昇格しない（field / hq は admin 操作で 403）
# ===========================================================================


@pytest.mark.parametrize("role", ["field", "hq"])
def test_non_admin_jwt_is_forbidden_on_admin_route(monkeypatch, role):
    """field / hq の JWT は admin 専用操作で 403（昇格しない）。"""
    with _client(monkeypatch, _settings()) as c:
        token = core_auth_mod.create_access_token(
            subject=f"{role}-user", auth_type="local", role=role
        )
        r = c.post(
            "/api/v1/sites",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, (
        f"role={role} の JWT で POST /api/v1/sites が {r.status_code}（期待は 403）。"
        "422 なら昇格している。"
    )


def test_hq_jwt_is_allowed_on_hq_route(monkeypatch):
    """hq ロールは hq 以上を要求する経路では通ること（締め出しすぎの歯止め）。

    ``require_hq_or_admin_or_api_key`` は現状 route から未使用のため、
    依存を直接呼んで契約を固定する。
    """
    fake = _settings()
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(core_auth_mod, "get_settings", lambda: fake)
    token = core_auth_mod.create_access_token(
        subject="hq-user", auth_type="local", role="hq"
    )
    from fastapi.security import HTTPAuthorizationCredentials

    user = require_hq_or_admin_or_api_key(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
        request=_request(),
    )
    assert user.role == "hq"


def test_field_jwt_is_allowed_on_any_user_route(monkeypatch):
    """field ロールの JWT は全ユーザー許可の経路では従来どおり許可される。

    MVP 公開デモは demo-login が払い出す field トークンで判定を記録する。
    ここを 403 にすると「read-only のはずが書けない」ではなく「デモが動かない」
    になり、意図した修正を超える。credentials があるときのロジックは不変。
    """
    fake = _settings()
    monkeypatch.setattr(api_auth_mod, "get_settings", lambda: fake)
    monkeypatch.setattr(core_auth_mod, "get_settings", lambda: fake)
    token = core_auth_mod.create_access_token(
        subject="demo", auth_type="local", role="field"
    )
    from fastapi.security import HTTPAuthorizationCredentials

    user = require_any_user_or_api_key(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
        request=_request(),
    )
    assert user.role == "field"


# ===========================================================================
# 6. 疎通確認を壊さない
# ===========================================================================


def test_anonymous_healthz_stays_reachable(monkeypatch):
    """資格情報なし GET /healthz は 200 のまま（監視・LB を壊さない）。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.get("/healthz")
    assert r.status_code == 200, f"匿名 GET /healthz が {r.status_code}。"


def test_anonymous_read_sites_stays_reachable(monkeypatch):
    """API キー未設定の公開 read-only デモ: 匿名 GET は到達できること。

    mutation を締める修正が読み取りまで巻き込むと、MVP の意図
    (誰でも閲覧できる read-only デモ) そのものが壊れる。
    """
    with _client(monkeypatch, _settings(), db=_NoopDB()) as c:
        r = c.get("/api/v1/sites")
    assert r.status_code == 200, f"匿名 GET /api/v1/sites が {r.status_code}。"


# ===========================================================================
# 7. 未知の site_id 形式でも認可が先に立つ（回帰の取りこぼし防止）
# ===========================================================================


def test_authorization_precedes_id_validation_for_thresholds(monkeypatch):
    """不正な UUID でも認可が先。401/403 が 422 に負けないこと。"""
    with _client(monkeypatch, _settings()) as c:
        r = c.delete("/api/v1/thresholds/not-a-uuid")
    assert r.status_code in (401, 403), f"不正 UUID で {r.status_code}。"


def test_threshold_uuid_constant_is_valid():
    """テストが使う UUID は書式として妥当（422 と 404 の取り違え防止）。"""
    assert uuid.UUID(_THRESHOLD_ID)
