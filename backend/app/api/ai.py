"""AI-assisted construction judgment endpoint.

POST /api/v1/ai/analyze

Analyzes weather / marine conditions against thresholds and returns a natural-
language recommendation.  When the environment variable ``WMCDSS_CLAUDE_API_KEY``
is set the analysis is delegated to Anthropic Claude (claude-haiku-4-5-20251001).
Otherwise a deterministic rule-based fallback generates the result in Japanese so
the feature works even without an API key.
"""
from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter(tags=["ai"])

_DISCLAIMER = (
    "(*) AI による分析は参考情報です。最終判定は必ず担当者が行ってください。"
)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class AiAnalyzeRequest(BaseModel):
    site_id: str
    work_type: Literal["concrete", "marine"]
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

async def _call_claude(prompt: str, api_key: str) -> str:
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
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 500,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code == 200:
                return str(resp.json()["content"][0]["text"])
    except Exception:  # noqa: BLE001
        log.warning("Claude API call failed; falling back to rule-based analysis")
    return ""


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/ai/analyze", response_model=AiAnalyzeResponse)
async def analyze(body: AiAnalyzeRequest) -> AiAnalyzeResponse:
    """AI-assisted construction judgment analysis.

    When ``WMCDSS_CLAUDE_API_KEY`` is set, the analysis is delegated to Claude
    AI.  Otherwise a deterministic rule-based analysis is used.
    """
    from app.core.config import get_settings  # local import avoids circular

    settings = get_settings()
    api_key: str = getattr(settings, "claude_api_key", "")

    # --- Rule-based analysis (always computed as baseline / fallback) ---
    if body.work_type == "concrete":
        result = _analyze_concrete(body.weather, body.thresholds)
    else:
        marine_data = body.marine or {}
        result = _analyze_marine(body.weather, marine_data, body.thresholds)

    # --- Optionally augment with Claude AI ---
    if api_key:
        if body.work_type == "concrete":
            prompt = (
                f"以下の気象データに基づき、コンクリート打設作業の可否を日本語で簡潔に説明してください。\n"
                f"気象: {body.weather}\n"
                f"しきい値: {body.thresholds}\n"
                f"ルールベース判定: {result['status']} — {result['summary']}\n"
                f"50文字以内で追加の専門的アドバイスがあれば加えてください。"
            )
        else:
            prompt = (
                f"以下の海象・気象データに基づき、海上作業の可否を日本語で簡潔に説明してください。\n"
                f"気象: {body.weather}\n"
                f"海象: {body.marine}\n"
                f"しきい値: {body.thresholds}\n"
                f"ルールベース判定: {result['status']} — {result['summary']}\n"
                f"50文字以内で追加の専門的アドバイスがあれば加えてください。"
            )

        ai_text = await _call_claude(prompt, api_key)
        if ai_text:
            result["summary"] = ai_text.strip()
            result["analysis_type"] = "claude_ai"

    result["disclaimer"] = _DISCLAIMER
    return AiAnalyzeResponse(**result)
