"""JWT 発行・検証 + Microsoft 365 ROPC 非対話式認証モジュール。

認証フロー:
  一般ログイン : username/password → bcrypt 検証 → JWT 発行
  M365 ログイン: email/password → MSAL ROPC → Graph API 検証 → JWT 発行

JWT はフロントエンドが Authorization: Bearer <token> ヘッダーで送信する。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

log = logging.getLogger(__name__)

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# パスワードユーティリティ
# ---------------------------------------------------------------------------

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_ctx.verify(plain, hashed)
    except Exception:
        return False


def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


# ---------------------------------------------------------------------------
# JWT 発行・検証
# ---------------------------------------------------------------------------

def create_access_token(subject: str, auth_type: str, extra: dict[str, Any] | None = None) -> str:
    s = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_expire_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "auth_type": auth_type,
        "exp": expire,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except JWTError as e:
        log.debug("JWT decode failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# 一般ログイン（ローカルユーザー）
# ---------------------------------------------------------------------------

def authenticate_local(username: str, password: str) -> dict[str, Any] | None:
    """ローカルユーザー認証。成功時にユーザー情報 dict を返す。"""
    s = get_settings()
    users = s.local_users_dict()
    hashed = users.get(username)
    if not hashed:
        log.warning("auth.local: unknown user '%s'", username)
        return None
    if not verify_password(password, hashed):
        log.warning("auth.local: wrong password for '%s'", username)
        return None
    return {"username": username, "auth_type": "local"}


# ---------------------------------------------------------------------------
# Microsoft 365 ROPC 非対話式認証
# ---------------------------------------------------------------------------

async def authenticate_m365(email: str, password: str) -> dict[str, Any] | None:
    """M365 ROPC フローでユーザー認証し、Graph API でプロフィールを取得する。

    非対話式: ユーザーはブラウザリダイレクトなしに WMCDSS に直接 M365 資格情報を入力する。
    """
    s = get_settings()
    if not s.entra_enabled:
        log.error("auth.m365: Entra ID が未設定です（env 変数を確認してください）")
        return None

    # ドメイン検証
    if not email.lower().endswith(f"@{s.entra_email_domain}"):
        log.warning("auth.m365: email domain not allowed: %s", email)
        return None

    authority = s.entra_authority or f"https://login.microsoftonline.com/{s.entra_tenant_id}"
    token_url = f"{authority}/oauth2/v2.0/token"

    # ROPC: クライアントがユーザー資格情報を直接 Entra ID へ送信
    token_data = {
        "grant_type": "password",
        "client_id": s.entra_client_id,
        "client_secret": s.entra_client_secret,
        "username": email,
        "password": password,
        "scope": s.entra_scope,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(token_url, data=token_data)

        if resp.status_code != 200:
            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            log.warning(
                "auth.m365: token endpoint returned %s — %s",
                resp.status_code,
                body.get("error_description", ""),
            )
            return None

        tokens = resp.json()
        access_token = tokens.get("access_token")
        if not access_token:
            log.error("auth.m365: no access_token in response")
            return None

        # Graph API でユーザー情報を取得・確認
        async with httpx.AsyncClient(timeout=10.0) as client:
            me_resp = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if me_resp.status_code != 200:
            log.error("auth.m365: Graph /me returned %s", me_resp.status_code)
            return None

        me = me_resp.json()
        display_name = me.get("displayName", email)
        mail = (me.get("mail") or me.get("userPrincipalName") or email).lower()

        log.info("auth.m365: success for %s (%s)", mail, display_name)
        return {
            "username": mail,
            "display_name": display_name,
            "auth_type": "m365",
        }

    except httpx.RequestError as e:
        log.error("auth.m365: network error — %s", e)
        return None
