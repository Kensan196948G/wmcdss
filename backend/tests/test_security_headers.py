"""SecurityHeadersMiddleware のテスト。

backend コンテナは 0.0.0.0 で listen しており nginx を経由せず直接叩ける。
そのため nginx 側にヘッダーがあることは、アプリ側に不要である根拠にならない。
ここでは「アプリ単体でヘッダーが付くこと」を固定する。

特に重要なのが**エラー応答にも付くこと**。攻撃者が最も多く観測するのは
401/404/422 であり、そこだけ無防備になる実装ミスは起きやすい。
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import SecurityHeadersMiddleware

_EXPECTED = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/ok")
    async def ok():
        return {"ok": True}

    @app.get("/boom")
    async def boom():
        raise HTTPException(status_code=401, detail="nope")

    @app.get("/preset")
    async def preset():
        from starlette.responses import JSONResponse

        return JSONResponse({"ok": True}, headers={"X-Frame-Options": "SAMEORIGIN"})

    return TestClient(app)


@pytest.mark.parametrize("name,value", _EXPECTED.items())
def test_headers_present_on_success(client, name, value):
    r = client.get("/ok")
    assert r.status_code == 200
    assert r.headers[name] == value


@pytest.mark.parametrize("name,value", _EXPECTED.items())
def test_headers_present_on_error_response(client, name, value):
    # 401 にも付くこと。ミドルウェアがルート層より外側にいる証拠でもある。
    r = client.get("/boom")
    assert r.status_code == 401
    assert r.headers[name] == value


def test_csp_present_on_api_response(client):
    r = client.get("/ok")
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


def test_csp_skipped_for_docs(client):
    # /docs は CDN からスクリプトを読むため CSP を当てない。ルートが未登録で
    # 404 になっても、パス判定は同じ経路を通るので挙動を確認できる。
    r = client.get("/docs")
    assert "Content-Security-Policy" not in r.headers
    # CSP 以外は付くこと — 除外したのは CSP だけ。
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_existing_header_is_not_overwritten(client):
    # setdefault 意味論: 前段や個別ルートが指定した値を尊重する。
    r = client.get("/preset")
    assert r.headers["X-Frame-Options"] == "SAMEORIGIN"
    # 重複して付いていないこと。
    assert len(r.headers.get_list("X-Frame-Options")) == 1


def test_no_hsts_over_plaintext():
    # 現状の配信は平文 HTTP。TLS が無いのに HSTS を名乗らないことを固定する。
    # TLS 導入時にこのテストを更新すること。
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/x")
    async def x():
        return {}

    r = TestClient(app).get("/x")
    assert "Strict-Transport-Security" not in r.headers
