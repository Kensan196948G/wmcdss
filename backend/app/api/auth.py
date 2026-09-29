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

    開発モード（api_keys が空）では読み取りを認証なしで通す。MVP の意図は
    「誰でも閲覧できる read-only デモ」であり、GET まで閉じるとその意図自体が
    壊れるためである。API キー層の `auth_required_methods`
    （既定 POST,PATCH,PUT,DELETE）は GET を対象にしないため、本番で GET の
    業務データを守るには route 側の検査が必須になる。

    ただし **admin 相当は返さない**。資格情報なしで admin を名乗る UserInfo を
    返すと、将来その role を認可判定に使った瞬間に昇格経路が復活する。
    無認証の読み取り身元は default_role（既定 field）とし、開発で admin 相当が
    必要な環境だけが WMCDSS_DEV_OPEN_ACCESS=true を明示する。
    """
    if credentials is not None:
        return get_current_user(credentials)
    s = get_settings()
    if not s.api_keys:
        if s.dev_open_access:
            return _dev_open_holder()
        return UserInfo(
            username="anon",
            display_name="Anonymous",
            auth_type="anonymous",
            role=s.default_role,
        )
    presented = request.headers.get("X-API-Key", "")
    if presented and key_matches(presented, s.api_keys):
        return _api_key_holder()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証トークンが必要です",
    )


def _api_key_holder() -> UserInfo:
    """有効な X-API-Key で到達した呼び出し元を admin 相当として扱う。

    API キーは運用側の機械連携（ETL・監視・スクリプト）専用で、全 mutation を
    許可する資格情報である。ロールを持たないため、明示的に admin 扱いとする。

    この関数を返してよいのは「X-API-Key が設定済みの鍵と一致した」ことを
    確認できた場合に限る。資格情報なしのリクエストは ``_api_key_holder()``
    ではなく :func:`_credential_less_holder` を通すこと（開発スタックが
    WMCDSS_DEV_OPEN_ACCESS=true を明示したときだけ admin 相当になる）。
    """
    return UserInfo(username="api-key", display_name="API Key", auth_type="api_key", role="admin")


def _dev_open_holder() -> UserInfo:
    """開発スタック (WMCDSS_DEV_OPEN_ACCESS=true) の資格情報なし呼び出し元。

    資格情報なしで admin 相当を許す唯一の経路。既定 false なので、この関数が
    返るのは開発者が明示的に opt-in した環境に限られる。本番相当の構成
    （docker-compose.production.yml / .env.production.example）はこのフラグを
    設定しない。
    """
    return UserInfo(username="dev", display_name="Development", auth_type="local", role="admin")


def _credential_less_holder(request: Request) -> UserInfo:
    """Bearer ヘッダーが無いリクエストの呼び出し元を解決する（fail-closed）。

    優先順位:
      1. `X-API-Key` が設定済みの鍵と一致: 機械連携の admin 相当。
         APIKeyMiddleware も通常の変更系メソッドでは先に同じ照合を行うが、
         `auth_exempt_paths` のパスでは middleware が働かない。ここで独立に
         照合することで「middleware が通したから安全」という前提に依存しない。
      2. `WMCDSS_DEV_OPEN_ACCESS=true`（開発スタック専用の明示 opt-in）: 従来の
         開発体験を維持するため admin 相当を返す。
      3. それ以外: 401。匿名リクエストを admin 相当へ昇格させない。

    api_keys を設定した本番構成では、変更系メソッドは 1 へ到達する前に
    APIKeyMiddleware が 401 で拒否するため、この分岐の追加によって挙動は
    変わらない（従来どおりの 401）。
    """
    s = get_settings()
    presented = request.headers.get("X-API-Key", "")
    if presented and key_matches(presented, s.api_keys):
        return _api_key_holder()
    if s.dev_open_access:
        return _dev_open_holder()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="認証トークンまたは有効な X-API-Key が必要です",
    )


def require_admin_or_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """管理操作（現場・閾値・ETL 実行・AI 設定等）の依存。

    - JWT あり: role=admin のみ許可（それ以外は 403）。
    - JWT なし: 有効な X-API-Key、または開発スタックの
      WMCDSS_DEV_OPEN_ACCESS=true のときだけ許可。それ以外は 401。
    """
    if credentials is not None:
        user = get_current_user(credentials)
        if user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="この操作には admin 権限が必要です",
            )
        return user
    return _credential_less_holder(request)


def require_hq_or_admin_or_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """本社・管理者向け操作（レポート等）の依存。

    資格情報なしの扱いは :func:`_credential_less_holder` に統一する
    （admin 用・any 用と規則を分けない。1 つでも緩い経路が残ると別経路になる）。
    """
    if credentials is not None:
        user = get_current_user(credentials)
        if user.role not in ("hq", "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="この操作には本社（hq）以上の権限が必要です",
            )
        return user
    return _credential_less_holder(request)


def require_any_user_or_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserInfo:
    """全ログインユーザー + API キー呼び出し元を許可する mutation 用依存。

    field ロールの JWT は「資格情報あり」なので従来どおり許可する
    （MVP 公開デモの判定記録を壊さない）。変わるのは資格情報なしの扱いだけで、
    :func:`_credential_less_holder` により fail-closed になる。
    """
    if credentials is not None:
        return get_current_user(credentials)
    return _credential_less_holder(request)


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

    JWT 経由（ブラウザ）では 403 にする。

    資格情報なし（= X-API-Key なし）の扱いは他の require_* 依存と同じ規則に
    統一する。`WMCDSS_DEV_OPEN_ACCESS=true` を明示した開発スタックだけが
    素通りでき、既定（false）では api_keys が空でも 403 で拒否する。
    理由: api_keys 未設定の公開 MVP では、以前はここが素通りしており、
    資格情報なしで観測値の投入（POST /api/v1/observations/weather|marine）が
    通っていた。観測値は施工判断（go/caution/stop）の入力そのものであるため、
    第三者があらゆる現場の判断を外部から操作できてしまう。
    """
    s = get_settings()
    if s.api_keys:
        presented = request.headers.get("X-API-Key", "")
        if not presented or not key_matches(presented, s.api_keys):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="このエンドポイントは API キー専用です",
            )
        return None
    # api_keys 未設定。開発スタックが dev_open_access を明示した場合だけ通す。
    if s.dev_open_access:
        return None
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="このエンドポイントは API キー専用です",
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
    "/demo-login",
    response_model=TokenResponse,
    summary="MVP 公開デモ用ログイン（資格情報なし）",
    include_in_schema=False,
)
async def login_demo() -> TokenResponse:
    """MVP 公開デモ: 資格情報なしでデモ利用者の JWT を払い出す。

    WMCDSS_AUTH_BYPASS=true の環境でのみ有効。無効時は 404 を返して
    この経路の存在自体を露出しない（本番では常に 404）。
    """
    s = get_settings()
    if not s.auth_bypass:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    username = s.auth_bypass_username
    role = s.auth_bypass_role if s.auth_bypass_role in ("field", "hq", "admin") else s.default_role
    token = create_access_token(
        subject=username,
        auth_type="local",
        extra={"display_name": username},
        role=role,
    )
    return TokenResponse(
        access_token=token,
        username=username,
        display_name=username,
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
