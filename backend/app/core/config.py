from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WMCDSS_", extra="ignore")

    app_name: str = "Weather-Marine Construction DSS"
    debug: bool = False

    # OpenAPI surface. True (dev default) exposes /docs, /redoc, /openapi.json.
    # Production typically sets WMCDSS_EXPOSE_OPENAPI=false so the schema is
    # not crawlable by anyone who reaches the public host. Same "open by
    # default, locked by env in prod" stance as `api_keys`.
    expose_openapi: bool = True

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
    # Note: "/" intentionally NOT here. GETs are already exempt via
    # auth_required_methods; listing "/" makes _exempt() refactors risky.
    auth_exempt_paths: list[str] = ["/healthz", "/readyz", "/docs", "/openapi.json"]

    # Rate limit: sliding window per identity (X-API-Key hash or client IP).
    # 0 = disabled (dev default; production sets e.g. 60). Applies to the same
    # mutation methods as auth so reads stay open for dashboards.
    rate_limit_per_minute: int = 0
    rate_limit_methods: list[str] = ["POST", "PATCH", "PUT", "DELETE"]
    # Health/ready probes must never 429 or systemd/k8s would mark the service
    # unhealthy under load. Kept separate from `auth_exempt_paths` because the
    # threat models diverge (auth-exempt ≠ should-bypass-DoS-protection).
    rate_limit_exempt_paths: list[str] = ["/healthz", "/readyz"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
