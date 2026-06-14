"""認証 API エンドポイント。

エンドポイント:
  POST /api/v1/auth/login        — ローカルユーザー認証
  POST /api/v1/auth/login/m365   — Microsoft 365 ROPC 非対話式認証
  GET  /api/v1/auth/me           — 現在の認証ユーザー情報
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from app.core.auth import (
    authenticate_local,
    authenticate_m365,
    create_access_token,
    decode_access_token,
)
from app.core.config import get_settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# スキーマ
# ---------------------------------------------------------------------------


class LocalLoginRequest(BaseModel):
    username: str
    password: str

    @field_validator("username", "password")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("空白のみの値は無効です")
        return v


class M365LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v:
            raise ValueError("有効なメールアドレスを入力してください")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    display_name: str
    auth_type: str
    expires_in_minutes: int


class UserInfo(BaseModel):
    username: str
    display_name: str
    auth_type: str


# ---------------------------------------------------------------------------
# 共通: JWT 検証依存関係
# ---------------------------------------------------------------------------


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="認証トークンが必要です"
        )
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="無効または期限切れのトークンです"
        )
    return UserInfo(
        username=payload.get("sub", ""),
        display_name=payload.get("display_name", payload.get("sub", "")),
        auth_type=payload.get("auth_type", "unknown"),
    )


# ---------------------------------------------------------------------------
# エンドポイント
# ---------------------------------------------------------------------------


@router.post("/login", response_model=TokenResponse, summary="一般ログイン（ローカル認証）")
async def login_local(body: LocalLoginRequest) -> TokenResponse:
    """ローカルユーザー名 + パスワードで認証し JWT を発行する。"""
    user = authenticate_local(body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザー名またはパスワードが正しくありません",
        )
    token = create_access_token(
        subject=user["username"],
        auth_type="local",
        extra={"display_name": user["username"]},
    )
    s = get_settings()
    return TokenResponse(
        access_token=token,
        username=user["username"],
        display_name=user["username"],
        auth_type="local",
        expires_in_minutes=s.jwt_expire_minutes,
    )


@router.post(
    "/login/m365", response_model=TokenResponse, summary="Microsoft 365 ログイン（非対話式 ROPC）"
)
async def login_m365(body: M365LoginRequest) -> TokenResponse:
    """M365 メールアドレス + パスワードで非対話式認証し JWT を発行する。

    Microsoft Entra ID の ROPC (Resource Owner Password Credentials) フローを使用。
    ブラウザリダイレクトなし。
    """
    s = get_settings()
    if not s.entra_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Microsoft 365 認証が設定されていません（管理者に連絡してください）",
        )

    user = await authenticate_m365(body.email, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Microsoft 365 の資格情報が無効です。メールアドレスとパスワードを確認してください。",
        )

    token = create_access_token(
        subject=user["username"],
        auth_type="m365",
        extra={"display_name": user.get("display_name", user["username"])},
    )
    return TokenResponse(
        access_token=token,
        username=user["username"],
        display_name=user.get("display_name", user["username"]),
        auth_type="m365",
        expires_in_minutes=s.jwt_expire_minutes,
    )


@router.get("/me", response_model=UserInfo, summary="現在の認証ユーザー情報")
async def get_me(current_user: UserInfo = Depends(get_current_user)) -> UserInfo:
    """有効な JWT トークンを持つ認証済みユーザーの情報を返す。"""
    return current_user
