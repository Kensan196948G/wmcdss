"""AI-assisted construction judgment endpoint.

POST /api/v1/ai/analyze
GET  /api/v1/ai/settings
POST /api/v1/ai/settings
POST /api/v1/ai/test

Analyzes weather / marine conditions against thresholds and returns a natural-
language recommendation.  When the environment variable ``WMCDSS_CLAUDE_API_KEY``
is set (or an API key is saved via POST /api/v1/ai/settings) the analysis is
delegated to Anthropic Claude.  Otherwise a deterministic rule-based fallback
generates the result in Japanese so the feature works even without an API key.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

# JWT 認証依存関係 — /ai/settings と /ai/test はログイン済みユーザーのみ許可。
# app.api.auth → app.core.auth → app.core.config のチェーンは一方向なので循環なし。
from app.api.auth import UserInfo, get_current_user

log = logging.getLogger(__name__)

router = APIRouter(tags=["ai"])

_DISCLAIMER = (
    "(*) AI による分析は参考情報です。最終判定は必ず担当者が行ってください。"
)

# ---------------------------------------------------------------------------
# Supported models
# ---------------------------------------------------------------------------

SUPPORTED_MODELS: list[dict[str, str]] = [
    {"id": "claude-opus-4-8", "label": "Claude Opus 4.8（最高精度）"},
    {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6（推奨・バランス型）"},
    {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5（高速・軽量）"},
]

# ---------------------------------------------------------------------------
# Settings persistence
# ---------------------------------------------------------------------------

def _settings_file() -> Path:
    from app.core.config import get_settings  # local import avoids circular

    return Path(get_settings().ai_settings_file)

# in-memory cache: populated on first access / after save
_ai_settings: dict[str, str] = {}


def _load_settings_file() -> None:
    """Load AI settings from the persistent JSON file into _ai_settings."""
    global _ai_settings
    settings_file = _settings_file()
    try:
        if settings_file.exists():
            data = json.loads(settings_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                _ai_settings = {k: str(v) for k, v in data.items() if isinstance(v, str)}
    except Exception:  # noqa: BLE001
        log.warning("Failed to load AI settings from %s; using defaults", settings_file)


def _save_settings_file() -> None:
    """Persist _ai_settings to disk with restrictive permissions (0o600).

    The parent directory is created with mode 0o700 so no other OS user can
    list or read the credential file even if umask allows group/world bits.
    Fails silently when the volume is read-only or permissions cannot be set.
    """
    settings_file = _settings_file()
    try:
        settings_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Use os.open() to set 0o600 atomically at creation time instead of
        # relying on Path.write_text() which uses the process umask.
        fd = os.open(
            str(settings_file),
            os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
            0o600,
        )
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(_ai_settings, fh, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        log.warning("Failed to save AI settings to %s; operating in-memory only", settings_file)


# Load on module import
_load_settings_file()


# ---------------------------------------------------------------------------
# Key / model helpers
# ---------------------------------------------------------------------------

def _get_api_key() -> str:
    from app.core.config import get_settings  # local import avoids circular

    return _ai_settings.get("api_key") or getattr(get_settings(), "claude_api_key", "")


def _get_model() -> str:
    from app.core.config import get_settings  # local import avoids circular

    return (
        _ai_settings.get("model")
        or getattr(get_settings(), "claude_model", "")
        or "claude-sonnet-4-6"
    )


def _mask_key(key: str) -> str | None:
    """Return last-4-char preview, or None if key is empty."""
    if not key:
        return None
    return f"sk-ant-...{key[-4:]}"


def _detect_source() -> Literal["ui", "env", "none"]:
    if _ai_settings.get("api_key"):
        return "ui"
    from app.core.config import get_settings  # local import avoids circular

    if getattr(get_settings(), "claude_api_key", ""):
        return "env"
    return "none"


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class AiAnalyzeRequest(BaseModel):
    site_id: str
    work_type: Literal["concrete", "marine"]
    audience: Literal["field", "manager"] = "field"
    weather: dict[str, Any]
    marine: dict[str, Any] | None = None
    thresholds: dict[str, Any]


class AiAnalyzeResponse(BaseModel):
    status: Literal["go", "caution", "stop"]
    summary: str
    issues: list[str]
    warnings: list[str]
    recommendations: list[str]
    confidence: Literal["高", "中", "低"]
    analysis_type: str
    disclaimer: str


class AiSettingsResponse(BaseModel):
    configured: bool
    key_preview: str | None
    model: str
    source: Literal["ui", "env", "none"]
    supported_models: list[dict[str, str]]


class AiSettingsSaveRequest(BaseModel):
    api_key: str = ""
    model: str = "claude-sonnet-4-6"

    @field_validator("api_key", "model")
    @classmethod
    def strip_values(cls, v: str) -> str:
        return v.strip()


class AiSettingsSaveResponse(BaseModel):
    saved: bool
    model: str
    key_preview: str | None


class AiTestRequest(BaseModel):
    api_key: str
    model: str = "claude-haiku-4-5-20251001"

    @field_validator("api_key", "model")
    @classmethod
    def strip_values(cls, v: str) -> str:
        return v.strip()


class AiTestResponse(BaseModel):
    ok: bool
    model: str | None = None
    latency_ms: int | None = None
    message: str


class AiAssistResponse(BaseModel):
    summary: str
    bullets: list[str]
    recommendations: list[str]
    analysis_type: str
    disclaimer: str


class AiEtlDiagnoseRequest(BaseModel):
    jobs: list[dict[str, Any]]


class AiRiskSummaryRequest(BaseModel):
    sites: list[dict[str, Any]]


class AiReportCommentRequest(BaseModel):
    template: str
    date_from: str | None = None
    date_to: str | None = None
    target: str | None = None
    recent_reports: list[dict[str, Any]] = []


class AiAnomalyDetectRequest(BaseModel):
    observations: list[dict[str, Any]]
    source_note: str | None = None


class AiChatRequest(BaseModel):
    question: str
    context: dict[str, Any] = {}

    @field_validator("question")
    @classmethod
    def strip_question(cls, v: str) -> str:
        return v.strip()


# ---------------------------------------------------------------------------
# Rule-based analysis helpers
# ---------------------------------------------------------------------------

def _analyze_concrete(weather: dict[str, Any], thresholds: dict[str, Any]) -> dict[str, Any]:
    """Rule-based analysis for concrete placement (コンクリート打設)."""
    issues: list[str] = []
    warnings: list[str] = []
    recommendations: list[str] = []

    # --- Wind speed ---
    wind = float(weather.get("wind", 0))
    wind_limit = float(thresholds.get("windSpeed", thresholds.get("wind_speed", 10)))
    if wind > wind_limit:
        issues.append(
            f"風速 {wind}m/s が施工中止基準 {wind_limit}m/s を超過しています"
        )
    elif wind > wind_limit * 0.8:
        warnings.append(
            f"風速 {wind}m/s が基準値 {wind_limit}m/s の80%に到達しています"
        )

    # --- Rainfall ---
    rain = float(weather.get("rain", 0))
    rain_limit = float(thresholds.get("rainfall", 10))
    if rain > rain_limit:
        issues.append(
            f"降水量 {rain}mm/h が施工中止基準 {rain_limit}mm/h を超過しています"
        )
    elif rain > 0:
        warnings.append(
            f"降水量 {rain}mm/h が観測されています。養生計画を確認してください"
        )

    # --- Temperature ---
    temp = float(weather.get("temp", 20))
    temp_low = float(thresholds.get("tempLow", thresholds.get("temp_low", 5)))
    temp_high = float(thresholds.get("tempHigh", thresholds.get("temp_high", 35)))
    if temp < temp_low:
        issues.append(
            f"気温 {temp}℃ が下限基準 {temp_low}℃ を下回っています（寒中コンクリート対策要）"
        )
    elif temp < temp_low + 2:
        warnings.append(
            f"気温 {temp}℃ が下限基準 {temp_low}℃ に接近しています（養生強化推奨）"
        )
    elif temp > temp_high:
        issues.append(
            f"気温 {temp}℃ が上限基準 {temp_high}℃ を超えています（暑中コンクリート対策要）"
        )
    elif temp > temp_high - 3:
        warnings.append(
            f"気温 {temp}℃ が上限基準 {temp_high}℃ に接近しています（散水養生推奨）"
        )

    # --- Humidity ---
    hum = float(weather.get("hum", 0))
    if hum > 85:
        warnings.append(
            f"湿度 {hum}% が高めです。コンクリート表面の品質管理に注意してください"
        )

    # --- Overall judgment ---
    if issues:
        status = "stop"
        summary = "施工中止を推奨します。以下の気象条件が基準を超過しています。"
        recommendations = [
            "施工を中止し、安全確保を最優先してください",
            "気象条件の改善を待ち、再判定を行ってください",
            "現場責任者および発注者へ速やかに報告してください",
        ]
    elif warnings:
        status = "caution"
        summary = "注意が必要です。気象条件が基準値に接近しています。"
        recommendations = [
            "作業開始前に現場責任者へ報告してください",
            "養生条件を強化し、気象状況を継続監視してください",
            "状況が悪化した場合は直ちに施工を中断してください",
        ]
    else:
        status = "go"
        summary = "現在の気象条件はコンクリート打設に適しています。"
        recommendations = [
            "通常の施工手順で作業を進めてください",
            "養生シートや散水設備を準備しておくことを推奨します",
            "定期的な気象状況の確認を継続してください",
        ]

    confidence = "高" if not warnings else "中"

    return {
        "status": status,
        "summary": summary,
        "issues": issues,
        "warnings": warnings,
        "recommendations": recommendations,
        "confidence": confidence,
        "analysis_type": "rule_based",
    }


def _analyze_marine(
    weather: dict[str, Any],
    marine: dict[str, Any],
    thresholds: dict[str, Any],
) -> dict[str, Any]:
    """Rule-based analysis for marine work (海上作業)."""
    issues: list[str] = []
    warnings: list[str] = []
    recommendations: list[str] = []

    # --- Wave height ---
    wave_h = float(marine.get("waveHeight", marine.get("wave_height", 0)))
    wave_limit = float(thresholds.get("waveHeight", thresholds.get("wave_height", 1.0)))
    if wave_h > wave_limit:
        issues.append(
            f"有義波高 {wave_h}m が施工中止基準 {wave_limit}m を超過しています"
        )
    elif wave_h > wave_limit * 0.8:
        warnings.append(
            f"有義波高 {wave_h}m が基準値 {wave_limit}m の80%に到達しています"
        )

    # --- Wind speed ---
    wind = float(weather.get("wind", 0))
    wind_limit = float(thresholds.get("windSpeed", thresholds.get("wind_speed", 10)))
    if wind > wind_limit:
        issues.append(
            f"風速 {wind}m/s が施工中止基準 {wind_limit}m/s を超過しています"
        )
    elif wind > wind_limit * 0.8:
        warnings.append(
            f"風速 {wind}m/s が基準値 {wind_limit}m/s の80%に到達しています"
        )

    # --- Wave period ---
    wave_period = float(marine.get("wavePeriod", marine.get("wave_period", 0)))
    if wave_period > 8:
        warnings.append(
            f"波周期 {wave_period}秒 が8秒を超えています。作業船の動揺に注意してください"
        )

    # --- Rainfall ---
    rain = float(weather.get("rain", 0))
    rain_limit = float(thresholds.get("rainfall", 10))
    if rain > rain_limit:
        issues.append(
            f"降水量 {rain}mm/h が施工中止基準 {rain_limit}mm/h を超過しています"
        )
    elif rain > 0:
        warnings.append(
            f"降水量 {rain}mm/h が観測されています。視界・甲板安全に注意してください"
        )

    # --- Overall judgment ---
    if issues:
        status = "stop"
        summary = "海上作業中止を推奨します。海象・気象条件が基準を超過しています。"
        recommendations = [
            "直ちに海上作業を中止し、船舶の安全確保を最優先してください",
            "作業員を安全な場所へ退避させてください",
            "気象海象条件の改善を待ち、再判定を行ってください",
        ]
    elif warnings:
        status = "caution"
        summary = "注意が必要です。一部の海象・気象条件が基準値に接近しています。"
        recommendations = [
            "作業船の動揺に注意し、安全監視員の配置を強化してください",
            "作業員に安全帯・救命具の着用を徹底させてください",
            "気象海象状況を継続監視し、悪化時は即座に作業を中断してください",
        ]
    else:
        status = "go"
        summary = "現在の海象・気象条件は海上作業に適しています。"
        recommendations = [
            "通常の安全手順に従い作業を進めてください",
            "定期的な気象海象状況の確認を継続してください",
            "安全監視員を適切に配置し、緊急時の退避経路を確保してください",
        ]

    confidence = "高" if not warnings else "中"

    return {
        "status": status,
        "summary": summary,
        "issues": issues,
        "warnings": warnings,
        "recommendations": recommendations,
        "confidence": confidence,
        "analysis_type": "rule_based",
    }


# ---------------------------------------------------------------------------
# Claude API call (optional)
# ---------------------------------------------------------------------------

def _anthropic_error_detail(resp: httpx.Response) -> str:
    """Extract a concise Anthropic error message from a non-2xx response."""
    try:
        payload = resp.json()
    except ValueError:
        text = resp.text.strip()
        return text[:240] if text else ""

    if not isinstance(payload, dict):
        return ""

    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        error_type = error.get("type")
        if isinstance(message, str) and message.strip():
            if isinstance(error_type, str) and error_type.strip():
                return f"{message.strip()} [{error_type.strip()}]"[:240]
            return message.strip()[:240]

    message = payload.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()[:240]

    return ""


def _format_anthropic_error(status: int, detail: str = "") -> str:
    """Return a user-facing Japanese error message for Anthropic responses."""
    if status == 400:
        msg = "リクエストエラー: Anthropic API が 400 を返しました"
    elif status == 401:
        msg = "認証エラー: APIキーが無効です (401)"
    elif status == 403:
        msg = "権限エラー: このAPIキーには必要な権限がありません (403)"
    elif status == 429:
        msg = "レート制限: リクエストが多すぎます (429)"
    elif status >= 500:
        msg = f"サーバーエラー: Anthropic API でエラーが発生しました ({status})"
    else:
        msg = f"エラー: Anthropic API がステータス {status} を返しました"

    return f"{msg} - {detail}" if detail else msg


async def _call_claude(
    prompt: str,
    api_key: str,
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 500,
) -> str:
    """Call Anthropic Claude API and return the response text.

    Returns empty string on any error so the caller can fall back gracefully.
    """
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code == 200:
                return str(resp.json()["content"][0]["text"])
            log.warning(
                "Claude API call returned %s: %s",
                resp.status_code,
                _anthropic_error_detail(resp),
            )
    except Exception:  # noqa: BLE001
        log.warning("Claude API call failed; falling back to rule-based analysis")
    return ""


def _clean_lines(text: str, limit: int = 6) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line or set(line) <= {"|", "-", " ", ":"}:
            continue
        line = line.strip("#>|` -・*0123456789. )　")
        if "|" in line:
            line = " / ".join(part.strip("* `") for part in line.split("|") if part.strip())
        line = line.replace("**", "").replace("`", "")
        if line and line not in lines:
            lines.append(line[:180])
        if len(lines) >= limit:
            break
    return lines


async def _assist_with_claude(
    prompt: str,
    fallback: AiAssistResponse,
    max_tokens: int = 700,
) -> AiAssistResponse:
    api_key = _get_api_key()
    if not api_key:
        return fallback

    ai_text = await _call_claude(prompt, api_key, _get_model(), max_tokens=max_tokens)
    if not ai_text:
        return fallback

    lines = _clean_lines(ai_text)
    return AiAssistResponse(
        summary=lines[0] if lines else ai_text.strip()[:240],
        bullets=lines[1:4] if len(lines) > 1 else fallback.bullets,
        recommendations=lines[4:6] if len(lines) > 4 else fallback.recommendations,
        analysis_type="claude_ai",
        disclaimer=_DISCLAIMER,
    )


def _job_label(job: dict[str, Any]) -> str:
    return str(job.get("name") or job.get("source") or f"job-{job.get('id', '?')}")


def _fallback_etl_diagnosis(jobs: list[dict[str, Any]]) -> AiAssistResponse:
    issues: list[str] = []
    ok_count = 0
    for job in jobs:
        status = str(job.get("status") or "unknown")
        label = _job_label(job)
        if status == "ok":
            ok_count += 1
        elif status == "stale":
            issues.append(f"{label} は取得時刻が古く、取得遅延の確認が必要です")
        elif status == "not_configured":
            issues.append(f"{label} は対象現場が未設定です")
        else:
            issues.append(f"{label} は状態が未取得です")

    if not issues:
        summary = f"データ取得は概ね正常です。{ok_count}件のジョブが正常状態です。"
        bullets = ["AMeDASと海象参考情報の状態を継続監視してください"]
    else:
        summary = "一部のデータ取得状態に確認事項があります。"
        bullets = issues

    recommendations = [
        "ジョブ一覧の最終実行時刻と取得件数を確認してください",
        "Open-Meteo Marine APIは情報共有用であり、施工判断の根拠には使用しません",
    ]
    return AiAssistResponse(
        summary=summary,
        bullets=bullets,
        recommendations=recommendations,
        analysis_type="rule_based",
        disclaimer=_DISCLAIMER,
    )


def _fallback_risk_summary(sites: list[dict[str, Any]]) -> AiAssistResponse:
    danger = [s for s in sites if str(s.get("status")) == "danger"]
    warn = [s for s in sites if str(s.get("status")) == "warn"]
    if danger:
        summary = f"中止推奨の現場が{len(danger)}件あります。優先確認が必要です。"
    elif warn:
        summary = f"注意状態の現場が{len(warn)}件あります。気象変化を継続監視してください。"
    else:
        summary = "現場全体は概ね基準内です。通常監視を継続してください。"

    bullets = [
        f"対象現場数: {len(sites)}件",
        f"中止推奨: {len(danger)}件 / 注意: {len(warn)}件",
    ]
    if warn:
        bullets.append("注意現場では風速・波高・降雨の基準接近を確認してください")
    return AiAssistResponse(
        summary=summary,
        bullets=bullets,
        recommendations=[
            "注意・中止推奨の現場から順に作業計画を見直してください",
            "海象参考情報は情報共有用として扱い、正式判定は既存ルールを優先してください",
        ],
        analysis_type="rule_based",
        disclaimer=_DISCLAIMER,
    )


def _fallback_report_comment(body: AiReportCommentRequest) -> AiAssistResponse:
    target = body.target or "対象範囲"
    period = "〜".join(v for v in [body.date_from, body.date_to] if v) or "指定期間"
    return AiAssistResponse(
        summary=f"{target}の{period}における{body.template}向け総括コメントです。",
        bullets=[
            "観測値、施工判定、停止理由を確認し、重要な変化を報告書本文に反映してください",
            f"最近のレポート履歴は{len(body.recent_reports)}件あります",
        ],
        recommendations=[
            "中止・注意判定がある日は、理由と対応を明記してください",
            "Open-Meteo Marine APIの値は参考情報として注記してください",
        ],
        analysis_type="rule_based",
        disclaimer=_DISCLAIMER,
    )


def _fallback_anomaly_detection(observations: list[dict[str, Any]]) -> AiAssistResponse:
    bullets: list[str] = []
    numeric_values: dict[str, list[float]] = {}
    for row in observations:
        for key, value in row.items():
            if isinstance(value, (int, float)):
                numeric_values.setdefault(key, []).append(float(value))
    for key, values in numeric_values.items():
        if len(values) < 2:
            continue
        span = max(values) - min(values)
        if span > 0:
            bullets.append(f"{key} の範囲は {min(values):.2f}〜{max(values):.2f} です")
    if not bullets:
        bullets = ["入力データだけでは明確な異常傾向は確認できません"]
    return AiAssistResponse(
        summary="観測値の急変・欠損・外部APIの違和感を確認しました。",
        bullets=bullets[:5],
        recommendations=[
            "急変がある場合は元データ時刻と取得元を確認してください",
            "参考海象データは施工判断へ直接使用しないでください",
        ],
        analysis_type="rule_based",
        disclaimer=_DISCLAIMER,
    )


def _fallback_chat(body: AiChatRequest) -> AiAssistResponse:
    question = body.question or "質問"
    return AiAssistResponse(
        summary="現在の画面データをもとに回答します。正式判断は既存の施工判定を確認してください。",
        bullets=[
            f"質問: {question[:120]}",
            "気象・海象・閾値・ジョブ状態の根拠時刻を確認してください",
        ],
        recommendations=[
            "施工可否はルールベース判定と現場責任者の確認を優先してください",
            "Open-Meteo Marine APIは情報共有用として扱ってください",
        ],
        analysis_type="rule_based",
        disclaimer=_DISCLAIMER,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/ai/settings", response_model=AiSettingsResponse)
async def get_ai_settings(
    _current_user: UserInfo = Depends(get_current_user),
) -> AiSettingsResponse:
    """Return current AI settings (API key is masked to last 4 chars)."""
    api_key = _get_api_key()
    return AiSettingsResponse(
        configured=bool(api_key),
        key_preview=_mask_key(api_key),
        model=_get_model(),
        source=_detect_source(),
        supported_models=SUPPORTED_MODELS,
    )


@router.post("/ai/settings", response_model=AiSettingsSaveResponse)
async def save_ai_settings(
    body: AiSettingsSaveRequest,
    _current_user: UserInfo = Depends(get_current_user),
) -> AiSettingsSaveResponse:
    """Save API key and model.  Pass empty string for api_key to delete the stored key."""
    global _ai_settings

    if body.api_key:
        _ai_settings["api_key"] = body.api_key
    else:
        _ai_settings.pop("api_key", None)

    _ai_settings["model"] = body.model
    _save_settings_file()

    effective_key = _get_api_key()
    return AiSettingsSaveResponse(
        saved=True,
        model=body.model,
        key_preview=_mask_key(effective_key),
    )


@router.post("/ai/test", response_model=AiTestResponse)
async def test_ai_connection(
    body: AiTestRequest,
    _current_user: UserInfo = Depends(get_current_user),
) -> AiTestResponse:
    """Send a minimal test request to the Anthropic API to verify the key."""
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": body.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": body.model,
                    "max_tokens": 16,
                    "messages": [{"role": "user", "content": "接続テスト。OKのみ返答してください。"}],
                },
            )
    except httpx.TimeoutException:
        return AiTestResponse(ok=False, message="タイムアウト: Anthropic API への接続がタイムアウトしました")
    except Exception as exc:  # noqa: BLE001
        return AiTestResponse(ok=False, message=f"接続エラー: {exc}")

    latency_ms = int((time.monotonic() - start) * 1000)

    if resp.status_code == 200:
        return AiTestResponse(
            ok=True,
            model=body.model,
            latency_ms=latency_ms,
            message="接続成功: Claude API に正常に接続できました",
        )

    status = resp.status_code
    msg = _format_anthropic_error(status, _anthropic_error_detail(resp))

    return AiTestResponse(ok=False, message=msg)


@router.post("/ai/analyze", response_model=AiAnalyzeResponse)
async def analyze(body: AiAnalyzeRequest) -> AiAnalyzeResponse:
    """AI-assisted construction judgment analysis.

    When an API key is configured (via UI settings or ``WMCDSS_CLAUDE_API_KEY``),
    the analysis is delegated to Claude AI.  Otherwise a deterministic
    rule-based analysis is used.
    """
    api_key = _get_api_key()
    model = _get_model()

    # --- Rule-based analysis (always computed as baseline / fallback) ---
    if body.work_type == "concrete":
        result = _analyze_concrete(body.weather, body.thresholds)
    else:
        marine_data = body.marine or {}
        result = _analyze_marine(body.weather, marine_data, body.thresholds)

    # --- Optionally augment with Claude AI ---
    if api_key:
        audience_text = "現場担当者向けに短く具体的に" if body.audience == "field" else "管理者向けに判断根拠と報告観点を含めて"
        if body.work_type == "concrete":
            prompt = (
                f"以下の気象データに基づき、コンクリート打設作業の可否を{audience_text}日本語で簡潔に説明してください。\n"
                f"気象: {body.weather}\n"
                f"しきい値: {body.thresholds}\n"
                f"ルールベース判定: {result['status']} — {result['summary']}\n"
                f"最終判定はルールベース判定であり、AIは補助説明のみです。\n"
                f"50文字以内で追加の専門的アドバイスがあれば加えてください。"
            )
        else:
            prompt = (
                f"以下の海象・気象データに基づき、海上作業の可否を{audience_text}日本語で簡潔に説明してください。\n"
                f"気象: {body.weather}\n"
                f"海象: {body.marine}\n"
                f"しきい値: {body.thresholds}\n"
                f"ルールベース判定: {result['status']} — {result['summary']}\n"
                f"Open-Meteo Marine APIの海象値は情報共有用であり、最終判定の根拠にはしないでください。\n"
                f"50文字以内で追加の専門的アドバイスがあれば加えてください。"
            )

        ai_text = await _call_claude(prompt, api_key, model)
        if ai_text:
            result["summary"] = ai_text.strip()
            result["analysis_type"] = "claude_ai"

    result["disclaimer"] = _DISCLAIMER
    return AiAnalyzeResponse(**result)


@router.post("/ai/etl-diagnose", response_model=AiAssistResponse)
async def etl_diagnose(body: AiEtlDiagnoseRequest) -> AiAssistResponse:
    fallback = _fallback_etl_diagnosis(body.jobs)
    prompt = (
        "以下のデータ取得ジョブ状態を日本語で診断してください。\n"
        "出力は1行要約、その後に確認事項と推奨対応を短い箇条書きにしてください。\n"
        "Open-Meteo Marine APIは情報共有用であり、施工判断の根拠にはしない旨を必要に応じて明記してください。\n"
        f"ジョブ状態: {body.jobs}"
    )
    return await _assist_with_claude(prompt, fallback)


@router.post("/ai/risk-summary", response_model=AiAssistResponse)
async def risk_summary(body: AiRiskSummaryRequest) -> AiAssistResponse:
    fallback = _fallback_risk_summary(body.sites)
    prompt = (
        "以下の現場一覧から、今後数時間で注意すべき現場リスクを日本語で要約してください。\n"
        "施工可否は既存ルールベース判定を優先し、AIは補助コメントに限定してください。\n"
        "現場担当者がすぐ確認すべき順に短く書いてください。\n"
        f"現場一覧: {body.sites}"
    )
    return await _assist_with_claude(prompt, fallback)


@router.post("/ai/report-comment", response_model=AiAssistResponse)
async def report_comment(body: AiReportCommentRequest) -> AiAssistResponse:
    fallback = _fallback_report_comment(body)
    prompt = (
        "施工支援システムのレポート総括コメントを日本語で作成してください。\n"
        "監査・報告書向けに、観測値、施工判定、停止理由、注意点を簡潔にまとめる文体にしてください。\n"
        "AIは補助コメントであり、正式報告前に担当者確認が必要です。\n"
        f"レポート条件: {body.model_dump()}"
    )
    return await _assist_with_claude(prompt, fallback)


@router.post("/ai/anomaly-detect", response_model=AiAssistResponse)
async def anomaly_detect(body: AiAnomalyDetectRequest) -> AiAssistResponse:
    fallback = _fallback_anomaly_detection(body.observations)
    prompt = (
        "以下の観測値について、急変・欠損・外部APIの違和感を日本語で確認してください。\n"
        "数値の正式判定は統計・ルールで行い、AIは説明と確認観点の提示に限定してください。\n"
        f"取得元注記: {body.source_note}\n"
        f"観測値: {body.observations}"
    )
    return await _assist_with_claude(prompt, fallback)


@router.post("/ai/chat", response_model=AiAssistResponse)
async def ai_chat(body: AiChatRequest) -> AiAssistResponse:
    fallback = _fallback_chat(body)
    prompt = (
        "あなたは海洋土木向け気象・海象施工支援システムの補助AIです。\n"
        "質問に対して、根拠データ、時刻、情報源、注意書きを含めて日本語で簡潔に回答してください。\n"
        "施工可否の最終判断は既存ルールと現場責任者が行う、と必ず明示してください。\n"
        "Open-Meteo Marine APIは情報共有用として扱ってください。\n"
        f"質問: {body.question}\n"
        f"画面コンテキスト: {body.context}"
    )
    return await _assist_with_claude(prompt, fallback, max_tokens=900)
