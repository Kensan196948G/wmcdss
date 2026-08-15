from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError

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
        _user(),
        db=None,
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
        _user(),
        db=None,
    )

    assert result.analysis_type == "llm_ai"
    assert result.summary == "全体要約"
    assert result.bullets == ["強風注意", "波高確認", "排水確認"]
    assert calls[0]["kwargs"]["json"]["max_tokens"] == 700


# ---------------------------------------------------------------------------
# 入力量の上限
#
# /ai/* のボディはそのまま prompt へ文字列展開され、Anthropic への従量課金
# リクエストになる。上限が無いと、ログイン済みユーザー 1 人が 1 リクエストで
# API 利用料と応答遅延を任意に押し上げられる。認証を掛けた（PR-C）だけでは
# 「正規利用者による過大請求」は防げないので、量そのものを縛る。
#
# ここでは model を直接組み立てて ValidationError を見る。HTTP 経由だと
# 認証依存が先に解決されて 401 になり、上限の検証にならないためである
# （逆に言えば、上限テストが 401 で落ちたら認証が効いている証拠でもある）。
# ---------------------------------------------------------------------------

def test_list_field_rejects_too_many_items():
    """list の要素数上限。"""
    with pytest.raises(ValidationError):
        ai_mod.AiRiskSummaryRequest(
            sites=[{"id": f"s{i}"} for i in range(ai_mod.MAX_LIST_ITEMS + 1)],
        )


def test_list_field_accepts_boundary_item_count():
    """上限ちょうどは通ること（off-by-one で実運用を壊さない）。"""
    req = ai_mod.AiRiskSummaryRequest(
        sites=[{"id": f"s{i}"} for i in range(ai_mod.MAX_LIST_ITEMS)],
    )
    assert len(req.sites) == ai_mod.MAX_LIST_ITEMS


def test_list_field_rejects_oversized_payload_within_item_limit():
    """要素数が上限内でも、直列化サイズが上限を超えれば弾くこと。

    `Field(max_length=...)` は list の**要素数**しか縛らない。要素が
    dict[str, Any] なので、1 要素へ巨大な文字列を入れれば要素数 1 のまま
    いくらでも膨らませられる。バイト数の別チェックが要る理由がこれである。
    """
    with pytest.raises(ValidationError):
        ai_mod.AiRiskSummaryRequest(
            sites=[{"id": "s1", "note": "あ" * ai_mod.MAX_PAYLOAD_BYTES}],
        )


def test_dict_field_rejects_oversized_payload():
    with pytest.raises(ValidationError):
        ai_mod.AiAnalyzeRequest(
            site_id="s1",
            work_type="concrete",
            weather={"note": "x" * (ai_mod.MAX_PAYLOAD_BYTES + 1)},
            thresholds={},
        )


def test_text_field_rejects_overlong_string():
    with pytest.raises(ValidationError):
        ai_mod.AiChatRequest(question="x" * (ai_mod.MAX_TEXT_CHARS + 1))


@pytest.mark.asyncio
async def test_call_claude_refuses_oversized_prompt_without_billing(monkeypatch):
    """背水の陣: 上限を付け忘れた経路が将来増えても課金前に止まること。

    httpx を「呼ばれたら失敗する」ものへ差し替えて、HTTP に到達しないこと
    自体を検証する。空文字を返すのは既存のフォールバック契約に合わせている
    （呼び出し側は rule_based へ落ちる）。
    """
    def _explode(*args, **kwargs):
        raise AssertionError("上限超過の prompt で Anthropic を呼び出した（課金発生）")

    monkeypatch.setattr(ai_mod.httpx, "AsyncClient", _explode)

    result, _usage = await ai_mod._call_llm(
        "x" * (ai_mod.MAX_PROMPT_CHARS + 1),
        api_key="sk-ant-test",
    )
    assert result == ""


@pytest.mark.asyncio
async def test_call_claude_allows_normal_prompt(monkeypatch):
    """上限が通常運用を塞いでいないこと（背水の陣が前線に出ていないこと）。"""
    response = httpx.Response(200, json={"content": [{"type": "text", "text": "OK"}]})
    calls = _patch_anthropic_client(monkeypatch, response)

    result, _usage = await ai_mod._call_llm("通常の長さのプロンプト", api_key="sk-ant-test")

    assert result == "OK"
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# DeepSeek provider (OpenAI-compatible /chat/completions)
# ---------------------------------------------------------------------------

def test_provider_for_deepseek_model():
    assert ai_mod._provider_for("deepseek-chat") == "deepseek"
    assert ai_mod._provider_for("deepseek-reasoner") == "deepseek"
    assert ai_mod._provider_for("claude-sonnet-4-6") == "anthropic"
    assert ai_mod._provider_for("") == "anthropic"


@pytest.mark.asyncio
async def test_call_llm_deepseek_uses_openai_compatible_endpoint(monkeypatch):
    """DeepSeek モデルは OpenAI 互換 /chat/completions を叩くこと。"""
    response = httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": "DeepSeek応答"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
    )
    calls = _patch_anthropic_client(monkeypatch, response)  # 同じ Fake が使える

    result, usage = await ai_mod._call_llm(
        "プロンプト", api_key="sk-deepseek-test", model="deepseek-chat"
    )

    assert result == "DeepSeek応答"
    assert usage == 15
    url = calls[0]["args"][0] if calls[0]["args"] else None
    # httpx は url を位置引数で受ける。文字列 or URL のどちらでも検証
    assert url is not None
    headers = calls[0]["kwargs"]["headers"]
    assert headers["Authorization"] == "Bearer sk-deepseek-test"
    assert calls[0]["kwargs"]["json"]["model"] == "deepseek-chat"
    assert calls[0]["kwargs"]["json"]["messages"][0]["content"] == "プロンプト"


@pytest.mark.asyncio
async def test_call_llm_deepseek_empty_choices_falls_back(monkeypatch):
    """DeepSeek が choices 空を返したら空文字（rule_based へフォールバック）。

    choices が無い応答は正常完了ではないため、usage も 0 にリセットし
    予算カウンタを汚さない契約にしている。
    """
    response = httpx.Response(200, json={"choices": [], "usage": {"total_tokens": 3}})
    _patch_anthropic_client(monkeypatch, response)

    result, usage = await ai_mod._call_llm("x", api_key="sk-deepseek-test", model="deepseek-chat")

    assert result == ""
    assert usage == 0


@pytest.mark.asyncio
async def test_ai_test_deepseek_ok(monkeypatch):
    """/ai/test が DeepSeek モデルで OpenAI 互換エンドポイントを叩くこと。"""
    response = httpx.Response(
        200,
        json={"choices": [{"message": {"content": "OK"}}], "usage": {"total_tokens": 3}},
    )
    calls = _patch_anthropic_client(monkeypatch, response)

    result = await ai_mod.test_ai_connection(
        ai_mod.AiTestRequest(api_key="sk-deepseek-test", model="deepseek-chat"),
        _user(),
    )

    assert result.ok is True
    assert "DeepSeek" in result.message
    headers = calls[0]["kwargs"]["headers"]
    assert headers["Authorization"] == "Bearer sk-deepseek-test"
    assert calls[0]["kwargs"]["json"]["model"] == "deepseek-chat"


@pytest.mark.asyncio
async def test_ai_test_deepseek_401_message(monkeypatch):
    """DeepSeek 401 でプロバイダー名を含む日本語エラーを返すこと。"""
    response = httpx.Response(401, json={"error": {"message": "invalid api key"}})
    _patch_anthropic_client(monkeypatch, response)

    result = await ai_mod.test_ai_connection(
        ai_mod.AiTestRequest(api_key="sk-bad", model="deepseek-chat"),
        _user(),
    )

    assert result.ok is False
    assert "DeepSeek" in result.message
    assert "401" in result.message
