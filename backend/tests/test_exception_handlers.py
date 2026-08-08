from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient


async def _global_exception_handler(request: Request, exc: Exception):
    logging.getLogger(__name__).error(
        "unhandled exception %s %s", request.method, request.url.path, exc_info=exc
    )
    return JSONResponse(status_code=500, content={"detail": "internal server error"})


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(Exception, _global_exception_handler)

    @app.get("/ok")
    async def ok():
        return {"ok": True}

    @app.get("/boom")
    async def boom():
        raise RuntimeError("something broke")

    @app.get("/http-boom")
    async def http_boom():
        raise HTTPException(status_code=401, detail="unauthorized")

    return TestClient(app, raise_server_exceptions=False)


def test_unhandled_exception_returns_500_json(client):
    r = client.get("/boom")
    assert r.status_code == 500
    assert r.headers["content-type"] == "application/json"
    body = r.json()
    assert body == {"detail": "internal server error"}


def test_unhandled_exception_logs_traceback(caplog, client):
    with caplog.at_level(logging.ERROR):
        client.get("/boom")
    assert "unhandled exception" in caplog.text
    assert "something broke" in caplog.text


def test_http_exception_preserves_original_behavior(client):
    r = client.get("/http-boom")
    assert r.status_code == 401
    assert r.json()["detail"] == "unauthorized"


def test_success_response_unchanged(client):
    r = client.get("/ok")
    assert r.status_code == 200
    assert r.json() == {"ok": True}