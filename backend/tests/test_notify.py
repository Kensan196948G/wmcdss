"""Notification service + digest job unit tests — no network/DB required."""
from __future__ import annotations

import asyncio

import httpx

from app.core.config import Settings
from app.jobs import notify_digest
from app.services import notify

_ORIG_ASYNC_CLIENT = httpx.AsyncClient


def _settings(**overrides) -> Settings:
    defaults = dict(
        notify_webhook_url="",
        notify_smtp_host="",
        notify_smtp_port=587,
        notify_smtp_user="",
        notify_smtp_password="",
        notify_from="wmcdss@example.invalid",
        notify_to_raw="",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def test_build_digest_groups_by_site(monkeypatch):
    body = notify_digest.build_digest([
        ("TYO-01", "東京港臨海", "marine_lift", "stop"),
        ("TYO-01", "東京港臨海", "crane", "caution"),
        ("TYO-02", "羽田D滑走路", "concrete", "caution"),
    ])
    assert "TYO-01 東京港臨海" in body
    assert "marine_lift: 中止推奨" in body
    assert "crane: 注意" in body
    assert "最終判定は現場責任者が行ってください" in body


def test_build_digest_empty():
    assert notify_digest.build_digest([]) == ""


def test_is_configured_false_by_default(monkeypatch):
    monkeypatch.setattr(notify, "get_settings", lambda: _settings())
    assert notify.is_configured() is False


def _client_factory(status: int):
    orig = _ORIG_ASYNC_CLIENT

    def handler(request):
        return httpx.Response(status, json={"ok": True})

    return lambda **kwargs: orig(transport=httpx.MockTransport(handler), **kwargs)


def test_send_webhook_success(monkeypatch):
    monkeypatch.setattr(
        notify, "get_settings",
        lambda: _settings(notify_webhook_url="https://hook.example.test/in"),
    )
    monkeypatch.setattr(notify.httpx, "AsyncClient", _client_factory(200))

    async def run():
        return await notify.send_webhook({"subject": "s", "text": "t"})

    assert asyncio.run(run()) is True


def test_send_webhook_http_error(monkeypatch):
    monkeypatch.setattr(
        notify, "get_settings",
        lambda: _settings(notify_webhook_url="https://hook.example.test/in"),
    )
    monkeypatch.setattr(notify.httpx, "AsyncClient", _client_factory(500))

    async def run():
        return await notify.send_webhook({"subject": "s", "text": "t"})

    assert asyncio.run(run()) is False


def test_send_email_not_configured(monkeypatch):
    monkeypatch.setattr(notify, "get_settings", lambda: _settings())

    async def run():
        return await notify.send_email("s", "b")

    assert asyncio.run(run()) is False


def test_notify_counts_configured_channels(monkeypatch):
    monkeypatch.setattr(
        notify, "get_settings",
        lambda: _settings(
            notify_webhook_url="https://hook.example.test/in",
            notify_smtp_host="smtp.example.test",
            notify_to_raw="ops@example.test",
        ),
    )

    async def fake_webhook(_payload: dict) -> bool:
        return True

    async def fake_email(_subject: str, _body: str) -> bool:
        return True

    monkeypatch.setattr(notify, "send_webhook", fake_webhook)
    monkeypatch.setattr(notify, "send_email", fake_email)

    assert asyncio.run(notify.notify("s", "b")) == 2


# ---------------------------------------------------------------------------
# job.run_once
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows
        self.committed = False
        self.added = []

    async def execute(self, stmt):
        return _FakeResult(self._rows)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        self.committed = True

    async def rollback(self):
        pass


class _FakeSessionCM:
    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *_):
        pass


def test_run_once_sends_digest_when_stop_exists(monkeypatch):
    rows = [("TYO-01", "東京港", "marine_lift", "stop")]
    db = _FakeSession(rows)
    monkeypatch.setattr(notify_digest, "SessionLocal", lambda: _FakeSessionCM(db))
    monkeypatch.setattr(notify, "is_configured", lambda: True)

    async def fake_notify(_subject: str, _body: str) -> int:
        return 1

    monkeypatch.setattr(notify, "notify", fake_notify)
    sent = asyncio.run(notify_digest.run_once())
    assert sent == 1
    assert db.committed
    assert any("notification.digest" == getattr(a, "action", None) for a in db.added)


def test_run_once_no_rows_sends_nothing(monkeypatch):
    db = _FakeSession([])
    monkeypatch.setattr(notify_digest, "SessionLocal", lambda: _FakeSessionCM(db))
    monkeypatch.setattr(notify, "is_configured", lambda: True)

    async def fake_notify(_subject: str, _body: str) -> int:
        raise AssertionError("should not send when no rows")

    monkeypatch.setattr(notify, "notify", fake_notify)
    sent = asyncio.run(notify_digest.run_once())
    assert sent == 0
    assert db.committed
