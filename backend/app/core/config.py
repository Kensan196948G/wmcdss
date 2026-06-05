from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


def _csv(raw: str) -> list[str]:
    """コンマ区切り文字列を list[str] に変換するヘルパー。"""
    return [s.strip() for s in raw.split(",") if s.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WMCDSS_", extra="ignore")

    app_name: str = "Weather-Marine Construction DSS"
    debug: bool = False

    expose_openapi: bool = True

    database_url: str = "postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss"

    # pydantic-settings v2 は list[str] の env 値に JSON 配列を期待するため、
    # コンマ区切り URL 文字列を受け取る際に SettingsError が発生する。
    # str フィールドとして受け取り、cors_origins property でリストに変換する。
    cors_origins_raw: str = (
        "http://172.23.10.251:9080,http://localhost:9080,http://127.0.0.1:9080"
    )

    @property
    def cors_origins(self) -> list[str]:
        return _csv(self.cors_origins_raw)

    jma_user_agent: str = "wmcdss/0.1 (+contact: kensan1969@gmail.com)"

    # API キー: コンマ区切り文字列。空文字列 = auth 無効（dev デフォルト）
    api_keys_raw: str = ""

    @property
    def api_keys(self) -> list[str]:
        return _csv(self.api_keys_raw)

    auth_required_methods: str = "POST,PATCH,PUT,DELETE"

    @property
    def auth_required_methods_list(self) -> list[str]:
        return _csv(self.auth_required_methods)

    # auth_exempt_paths は固定値のため list[str] のままとする（env からは設定しない）
    auth_exempt_paths: list[str] = [
        "/healthz", "/readyz", "/docs", "/openapi.json", "/metrics",
        "/api/v1/auth/login", "/api/v1/auth/login/m365",
    ]

    rate_limit_per_minute: int = 0
    rate_limit_methods: list[str] = ["POST", "PATCH", "PUT", "DELETE"]
    rate_limit_exempt_paths: list[str] = ["/healthz", "/readyz", "/metrics"]

    # -------------------------------------------------------------------------
    # JWT 認証設定
    # -------------------------------------------------------------------------
    jwt_secret: str = "dev-secret-please-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8時間

    # ローカルユーザー: "username:bcrypt_hash" 形式カンマ区切り
    local_users: str = ""

    # -------------------------------------------------------------------------
    # Microsoft 365 / Entra ID 非対話式認証 (ROPC)
    # -------------------------------------------------------------------------
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_secret: str = ""
    entra_authority: str = ""
    entra_scope: str = "https://graph.microsoft.com/User.Read"
    entra_email_domain: str = "mirai-const.co.jp"

    @property
    def entra_enabled(self) -> bool:
        return bool(self.entra_tenant_id and self.entra_client_id and self.entra_client_secret)

    def local_users_dict(self) -> dict[str, str]:
        """ローカルユーザー設定を {username: bcrypt_hash} 辞書に変換。"""
        result: dict[str, str] = {}
        for entry in self.local_users.split(","):
            entry = entry.strip()
            if ":" in entry:
                username, hashed = entry.split(":", 1)
                result[username.strip()] = hashed.strip()
        return result


@lru_cache
def get_settings() -> Settings:
    return Settings()
