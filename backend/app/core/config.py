from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WMCDSS_", extra="ignore")

    app_name: str = "Weather-Marine Construction DSS"
    debug: bool = False

    database_url: str = "postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss"

    cors_origins: list[str] = [
        "http://192.168.0.185:8888",
        "http://localhost:8888",
        "http://127.0.0.1:8888",
    ]

    jma_user_agent: str = "wmcdss/0.1 (+contact: kensan1969@gmail.com)"

    # Write-side API keys: comma-separated in env (WMCDSS_API_KEYS=k1,k2,k3).
    # Empty list disables auth (dev default). Production sets at least one.
    api_keys: list[str] = []
    auth_required_methods: list[str] = ["POST", "PATCH", "PUT", "DELETE"]
    auth_exempt_paths: list[str] = ["/healthz", "/readyz", "/docs", "/openapi.json", "/"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
