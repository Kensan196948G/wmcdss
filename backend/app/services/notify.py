"""警戒・中止ダイジェストの通知（Webhook / SMTP）。

どちらも未設定なら no-op。送信失敗はログに残すだけで例外を伝播させない
（通知は判定・監査のクリティカルパスではない）。
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import get_settings

log = logging.getLogger("wmcdss.services.notify")


def is_configured() -> bool:
    s = get_settings()
    return bool(s.notify_webhook_url or (s.notify_smtp_host and s.notify_to))


async def send_webhook(payload: dict) -> bool:
    """汎用 Webhook へ JSON を POST する（Slack/Teams/LINE WORKS 等の変換層）。"""
    s = get_settings()
    if not s.notify_webhook_url:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(s.notify_webhook_url, json=payload)
        if resp.status_code >= 400:
            log.error("notify.webhook: HTTP %s from %s", resp.status_code, s.notify_webhook_url)
            return False
        log.info("notify.webhook: sent %s bytes to %s", len(str(payload)), s.notify_webhook_url)
        return True
    except httpx.HTTPError as exc:
        log.error("notify.webhook: send failed: %s", exc)
        return False


async def send_email(subject: str, body: str) -> bool:
    """SMTP でメール送信（認証あり）。未設定なら False。"""
    import smtplib
    from email.message import EmailMessage

    s = get_settings()
    if not s.notify_smtp_host or not s.notify_to:
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.notify_from
    msg["To"] = ", ".join(s.notify_to)
    msg.set_content(body)
    try:
        with smtplib.SMTP(s.notify_smtp_host, s.notify_smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if s.notify_smtp_user:
                smtp.login(s.notify_smtp_user, s.notify_smtp_password)
            smtp.send_message(msg)
        log.info("notify.email: sent '%s' to %s", subject, s.notify_to)
        return True
    except Exception as exc:  # noqa: BLE001 — SMTP 系の例外は多様
        log.error("notify.email: send failed: %s", exc)
        return False


async def notify(subject: str, body: str) -> int:
    """設定済みの経路すべてへ送信し、送信成功数を返す。"""
    sent = 0
    if await send_webhook({"subject": subject, "text": body}):
        sent += 1
    if await send_email(subject, body):
        sent += 1
    return sent
