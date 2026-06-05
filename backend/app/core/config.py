from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WMCDSS_", extra="ignore")

    app_name: str = "Weather-Marine Construction DSS"
    debug: bool = False

    expose_openapi: bool = True

    database_url: str = "postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss"

    cors_origins: list[str] = [
        "http://172.23.10.251:9080",
        "http://localhost:9080",
        "http://127.0.0.1:9080",
    ]

    jma_user_agent: str = "wmcdss/0.1 (+contact: kensan1969@gmail.com)"

    api_keys: list[str] = []
    auth_required_methods: list[str] = ["POST", "PATCH", "PUT", "DELETE"]
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
    # 例: "admin:$2b$12$xxx,operator:$2b$12$yyy"
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
