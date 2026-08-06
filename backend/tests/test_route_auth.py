"""Route レベル認可の不変条件テスト。

本システムの認証は 2 層ある。

  1. API キー層 (app/core/security.py APIKeyMiddleware)
     `X-API-Key` を検査する。ただし `auth_required_methods`
     (既定 POST,PATCH,PUT,DELETE) のメソッドしか対象にせず、
     `auth_exempt_paths` のパスは丸ごと免除する。
  2. JWT 層 (app/api/auth.py get_current_user)
     route ごとに `Depends` で個別に適用する。

ブラウザは `X-API-Key` を持たないため、WebUI から叩く経路は 1 を免除して
2 を付ける、という対で運用している。この「対」が崩れた瞬間に無認証の穴が
開くが、**免除リストと route 定義は別ファイルにある**ため、片方だけ編集
されても普通のテストでは気づけない。

そこで個別の route をハードコードせず、
「免除リストに載っている ⇒ JWT を要求する」という不変条件そのものを固定する。
新しいパスを免除リストへ足して JWT を付け忘れれば、このテストが落ちる。

検査は依存ツリーの内部検査ではなく、TestClient で実際に叩いた応答で行う。
FastAPI の内部表現 (0.141 では `_IncludedRouter` による遅延展開) は版ごとに
変わるうえ、内部が「付いている」ことと実際に「効いている」ことは別物である。
経路の列挙には公開 API の `app.openapi()` を使う。
"""

from __future__ import annotations

import importlib
import re

import pytest
from fastapi.testclient import TestClient

from app.core import config as config_mod
from app.db.session import get_db

# API キー層の免除リストのうち、本当に無認証でよいもの。
# ログイン自体（認証前に呼ぶ必要がある）と、監視・疎通確認の経路に限る。
_PUBLICLY_ALLOWED = {
    "/healthz",
    "/readyz",
    "/docs",
    "/openapi.json",
    "/metrics",
    "/api/v1/auth/login",
    "/api/v1/auth/login/m365",
}

# 免除リストには載っていないが、JWT が唯一の防御になる経路。
# GET のため API キー層（既定 POST,PATCH,PUT,DELETE）を素通りする。
_GET_ONLY_SENSITIVE_PATHS = ["/api/v1/audit"]

_PATH_PARAM = re.compile(r"\{[^}]+\}")


class _UnusableDB:
    """呼ばれたら失敗する DB スタブ。

    未認証リクエストが DB へ到達しないこと自体を検証したいので、
    「動く偽物」ではなく「触ったら落ちる番人」を差し込む。
    """

    def __getattr__(self, name):
        raise AssertionError(
            f"未認証リクエストが DB ({name}) へ到達した。認証依存を DB 依存より先に宣言すること。"
        )


@pytest.fixture
def client(monkeypatch):
    """設定を dev 相当に固定して app.main を組み立て直した TestClient。

    `allow_insecure_defaults=True` は dev compose と同じ姿勢。これがないと
    app.main トップレベルの `enforce_security_posture()` が既定の jwt_secret と
    空の api_keys を検出して import 自体を失敗させる。ここで確かめたいのは
    route の認可であって設定検証ではない。

    `api_keys` が空なので APIKeyMiddleware は素通りする。つまりこのテストは
    「API キー層が無効でも JWT 層だけで守れているか」を見ている。免除リストの
    意味を考えれば、これが本番で守ってほしい姿そのものである。
    """
    fake = config_mod.Settings(allow_insecure_defaults=True)
    monkeypatch.setattr(config_mod, "get_settings", lambda: fake)
    import app.main as main_mod

    importlib.reload(main_mod)

    async def _no_db():
        yield _UnusableDB()

    main_mod.app.dependency_overrides[get_db] = _no_db
    with TestClient(main_mod.app) as c:
        yield c
    # 他テスト / smoke 実行へ影響を残さないよう正規の app へ戻す。
    importlib.reload(main_mod)


def _operations(client: TestClient) -> list[tuple[str, str]]:
    """(method, path) を OpenAPI から列挙する。"""
    schema = client.app.openapi()
    return [
        (method.upper(), path)
        for path, item in schema.get("paths", {}).items()
        for method in item
        if method.upper() in {"GET", "POST", "PATCH", "PUT", "DELETE"}
    ]


def _request(client: TestClient, method: str, path: str):
    """パスパラメータへダミーを埋め、ボディは空 JSON で叩く。

    ボディ検証エラー (422) ではなく 401 が返ることを期待している。FastAPI は
    依存の解決を本体パラメータの検証より先に行うため、認証依存があれば
    ボディが不正でも 401 が先に立つ。これは「401 が返る = 認証が効いている」を
    ボディスキーマの知識なしに判定できるということでもある。
    """
    url = _PATH_PARAM.sub("1", path)
    return client.request(method, url, json={})


def _match(path: str, prefix: str) -> bool:
    """APIKeyMiddleware の `_exempt()` と同じ突き合わせ方（完全一致 or 配下）。"""
    return path == prefix or path.startswith(prefix.rstrip("/") + "/")


def test_every_api_key_exempt_route_requires_jwt(client):
    """免除リストのパスは、公開が妥当なもの以外すべて 401 を返すこと。"""
    operations = _operations(client)
    unprotected: list[str] = []

    for exempt in config_mod.Settings().auth_exempt_paths:
        if exempt in _PUBLICLY_ALLOWED:
            continue
        matched = [(m, p) for m, p in operations if _match(p, exempt)]
        assert matched, (
            f"免除リストの {exempt!r} に対応する route が存在しない。"
            "リストと実装が乖離している（route 削除・改名の取り残し）。"
        )
        for method, path in matched:
            status = _request(client, method, path).status_code
            if status != 401:
                unprotected.append(f"{method} {path} -> {status}")

    assert not unprotected, (
        "API キー層から免除されているのに、未認証で 401 にならない route がある。"
        "Depends(get_current_user) を付けるか、免除リストから外すこと: " + ", ".join(unprotected)
    )


@pytest.mark.parametrize("sensitive", _GET_ONLY_SENSITIVE_PATHS)
def test_sensitive_get_routes_require_jwt(client, sensitive):
    """GET のため API キー層が素通りする機微な経路が 401 を返すこと。"""
    matched = [(m, p) for m, p in _operations(client) if _match(p, sensitive)]
    assert matched, f"{sensitive!r} に対応する route が存在しない"
    for method, path in matched:
        assert _request(client, method, path).status_code == 401, (
            f"{method} {path} は GET なので API キー層では保護されない。"
            "JWT が唯一の防御であり、外すと無認証で読める。"
        )


def test_bogus_token_is_rejected(client):
    """署名を検証していない（トークンが有れば通る）実装になっていないこと。"""
    r = client.post(
        "/api/v1/ai/chat",
        headers={"Authorization": "Bearer not-a-real-jwt"},
        json={"question": "test"},
    )
    assert r.status_code == 401


def test_login_routes_stay_reachable_without_jwt(client):
    """ログイン経路には JWT を要求しないこと。

    上の不変条件へ過剰反応して「全部に付ける」と、トークンを得る手段自体が
    トークンを要求する堂々巡りになり、全利用者が締め出される。
    締め出しの方向にも歯止めを置く。

    ボディが空なので 422 になるはずだが、ここで固定したいのは
    「401 ではないこと」だけ。ログインのスキーマ変更で壊れない形にしてある。
    """
    for path in ("/api/v1/auth/login", "/api/v1/auth/login/m365"):
        status = _request(client, "POST", path).status_code
        assert status != 401, (
            f"POST {path} が未認証で 401 を返した。"
            "ログイン前に呼ぶ経路なので、誰もログインできなくなる。"
        )
