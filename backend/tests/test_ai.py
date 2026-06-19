from __future__ import annotations

import httpx
import pytest

import app.api.ai as ai_mod
from app.api.auth import UserInfo


class _FakeAnthropicClient:
    def __init__(self, response: httpx.Response, calls: list[dict]):
        self.response = response
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        self.calls.append({"args": args, "kwargs": kwargs})
        return self.response


def _patch_anthropic_client(monkeypatch, response: httpx.Response) -> list[dict]:
    calls: list[dict] = []

    def _factory(*args, **kwargs):
        return _FakeAnthropicClient(response, calls)

    monkeypatch.setattr(ai_mod.httpx, "AsyncClient", _factory)
    return calls


def _user() -> UserInfo:
    return UserInfo(username="tester", display_name="tester", auth_type="local")


@pytest.mark.asyncio
async def test_ai_test_returns_anthropic_400_detail(monkeypatch):
    response = httpx.Response(
        400,
        json={
            "type": "error",
            "error": {
                "type": "invalid_request_error",
                "message": "model: invalid model id",
            },
        },
    )
    _patch_anthropic_client(monkeypatch, response)

    result = await ai_mod.test_ai_connection(
        ai_mod.AiTestRequest(api_key="sk-ant-test", model="bad-model"),
        _user(),
    )

    assert result.ok is False
    assert "400" in result.message
    assert "model: invalid model id" in result.message
    assert "invalid_request_error" in result.message


@pytest.mark.asyncio
async def test_ai_test_strips_api_key_and_uses_connection_test_payload(monkeypatch):
    response = httpx.Response(
        200,
        json={"content": [{"type": "text", "text": "OK"}]},
    )
    calls = _patch_anthropic_client(monkeypatch, response)

    result = await ai_mod.test_ai_connection(
        ai_mod.AiTestRequest(api_key="  sk-ant-test  ", model=" claude-sonnet-4-6 "),
        _user(),
    )

    assert result.ok is True
    assert calls[0]["kwargs"]["headers"]["x-api-key"] == "sk-ant-test"
    assert calls[0]["kwargs"]["json"]["model"] == "claude-sonnet-4-6"
    assert calls[0]["kwargs"]["json"]["max_tokens"] == 16


@pytest.mark.asyncio
async def test_etl_diagnose_falls_back_without_api_key(monkeypatch):
    monkeypatch.setattr(ai_mod, "_get_api_key", lambda: "")

    result = await ai_mod.etl_diagnose(
        ai_mod.AiEtlDiagnoseRequest(
            jobs=[
                {"id": 1, "name": "AMeDAS", "status": "ok", "records": 10},
                {"id": 2, "name": "海象参考情報", "status": "stale", "records": 5},
            ],
        ),
    )

    assert result.analysis_type == "rule_based"
    assert "確認事項" in result.summary or "確認" in " ".join(result.bullets)
    assert any("Open-Meteo" in item for item in result.recommendations)


@pytest.mark.asyncio
async def test_risk_summary_uses_claude_when_configured(monkeypatch):
    monkeypatch.setattr(ai_mod, "_get_api_key", lambda: "sk-ant-test")
    monkeypatch.setattr(ai_mod, "_get_model", lambda: "claude-sonnet-4-6")
    response = httpx.Response(
        200,
        json={"content": [{"type": "text", "text": "全体要約\n強風注意\n波高確認\n排水確認\n作業前確認\n現場責任者へ共有"}]},
    )
    calls = _patch_anthropic_client(monkeypatch, response)

    result = await ai_mod.risk_summary(
        ai_mod.AiRiskSummaryRequest(
            sites=[
                {"id": "s1", "name": "A現場", "status": "warn", "weather": {"wind": 9}},
            ],
        ),
    )

    assert result.analysis_type == "claude_ai"
    assert result.summary == "全体要約"
    assert result.bullets == ["強風注意", "波高確認", "排水確認"]
    assert calls[0]["kwargs"]["json"]["max_tokens"] == 700
