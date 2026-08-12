"""認証 API エンドポイント。

エンドポイント:
  POST /api/v1/auth/login        — ローカルユーザー認証
  POST /api/v1/auth/login/m365   — Microsoft 365 ROPC 非対話式認証
  GET  /api/v1/auth/me           — 現在の認証ユーザー情報
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from app.core.auth import (
    authenticate_local,
    authenticate_m365,
    create_access_token,
    decode_access_token,
)
from app.core.config import get_settings
from app.core.security import key_matches

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
    role: str
    expires_in_minutes: int


class UserInfo(BaseModel):
    username: str
    display_name: str
    auth_type: str
    role: str = "field"

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


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
        role=payload.get("role", "field"),
    )


def _role_for(username: str) -> str:
    role = get_settings().role_for(username)
    return role if role in ("field", "hq", "admin") else get_settings().default_role


def get_current_user_or_anon(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    request: Request = None,  # type: ignore[assignment]  # FastAPI が注入する
) -> UserInfo:
    """本番（API キー設定済み）では JWT または API キーを要求する GET 用依存。

    開発モード（api_keys が空）では認証を要求しない。API キー層の
    `auth_required_methods`（既定 POST,PATCH,PUT,DELETE）は GET を対象にしない
    ため、本番で GET の業務データを守るには route 側の検査が必須になる。
    """
    if credentials is not None:
        return get_current_user(credentials)
    s = get_settings()
    if not s.api_keys:
        return UserInfo(username="dev", display_name="Development", auth_type="local", role="admin")
    presented = request.headers.get("X-API-Key", "")
    if presented and key_matches(presented, s.api_keys):
        return _api_key_holder()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証トークンが必要です",
    )


def _api_key_holder() -> UserInfo:
    """API キーで到達した呼び出し元を admin 相当として扱う。

    API キーは運用側の機械連携（ETL・監視・スクリプト）専用で、全 mutation を
    許可する資格情報である（APIKeyMiddleware が照合済み）。ロールを持たない
    ため、明示的に admin 扱いとする。
    """
    return UserInfo(username="api-key", display_name="API Key", auth_type="api_key", role="admin")


def require_admin_or_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """管理操作（現場・閾値・ETL 実行・AI 設定等）の依存。

    - JWT あり: role=admin のみ許可（それ以外は 403）。
    - JWT なし: API キー経路（middleware が照合済み）または開発モードとして許可。
    """
    if credentials is not None:
        user = get_current_user(credentials)
        if user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="この操作には admin 権限が必要です",
            )
        return user
    return _api_key_holder()


def require_hq_or_admin_or_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """本社・管理者向け操作（レポート等）の依存。"""
    if credentials is not None:
        user = get_current_user(credentials)
        if user.role not in ("hq", "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="この操作には本社（hq）以上の権限が必要です",
            )
        return user
    return _api_key_holder()


def require_any_user_or_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """全ログインユーザー + API キー呼び出し元を許可する mutation 用依存。"""
    if credentials is not None:
        return get_current_user(credentials)
    return _api_key_holder()


def require_admin_jwt(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """JWT 必須 + role=admin のみ許可（監査ログ・AI 設定等の機微操作）。"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="認証トークンが必要です",
        )
    user = get_current_user(credentials)
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には admin 権限が必要です",
        )
    return user


def require_hq_or_admin_jwt(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """JWT 必須 + role=hq/admin のみ許可（レポート等）。"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="認証トークンが必要です",
        )
    user = get_current_user(credentials)
    if user.role not in ("hq", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には本社（hq）以上の権限が必要です",
        )
    return user


def require_machine_client(request: Request) -> None:
    """観測値投入など API キー専用エンドポイントの依存。

    JWT 経由（ブラウザ）では 403 にする。開発モード（api_keys 空）では素通り。
    """
    s = get_settings()
    if not s.api_keys:
        return None
    presented = request.headers.get("X-API-Key", "")
    if not presented or not key_matches(presented, s.api_keys):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このエンドポイントは API キー専用です",
        )
    return None


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
        role=_role_for(user["username"]),
    )
    s = get_settings()
    role = _role_for(user["username"])
    return TokenResponse(
        access_token=token,
        username=user["username"],
        display_name=user["username"],
        auth_type="local",
        role=role,
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
        role=_role_for(user["username"]),
    )
    role = _role_for(user["username"])
    return TokenResponse(
        access_token=token,
        username=user["username"],
        display_name=user.get("display_name", user["username"]),
        auth_type="m365",
        role=role,
        expires_in_minutes=s.jwt_expire_minutes,
    )


@router.get("/me", response_model=UserInfo, summary="現在の認証ユーザー情報")
async def get_me(current_user: UserInfo = Depends(get_current_user)) -> UserInfo:
    """有効な JWT トークンを持つ認証済みユーザーの情報を返す。"""
    return current_user
