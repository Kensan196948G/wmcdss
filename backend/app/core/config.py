from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


def _csv(raw: str) -> list[str]:
    """コンマ区切り文字列を list[str] に変換するヘルパー。"""
    return [s.strip() for s in raw.split(",") if s.strip()]


# 開発用 JWT 秘密鍵の番兵値。名前に反して「秘密」ではなく、リポジトリを読める
# 全員が知っている公開の既定値である。だからこそ、この値のまま本番が起動すると
# 誰でも任意の `sub` を持つトークンを偽造できる。app/core/startup.py がこの定数
# との一致を検出して起動を拒否する。定数として切り出すのは、検証側と既定値側が
# 別々に編集されて静かに乖離するのを防ぐため。
DEV_JWT_SECRET_SENTINEL = "dev-secret-please-change-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="WMCDSS_", extra="ignore")

    app_name: str = "Weather-Marine Construction DSS"
    debug: bool = False

    # 危険な既定値のまま起動することを明示的に許可するフラグ（開発専用）。
    # 既定を False にしてあるため、何も設定しなければ本番は fail-closed になる。
    # 「開発では便利に、本番では安全に」を debug フラグで兼ねなかったのは、
    # docker-compose.yml と docker-compose.production.yml が **どちらも**
    # `WMCDSS_DEBUG: ${WMCDSS_DEBUG:-false}` を渡しており、debug が実際には
    # dev/prod の切り替えとして機能していないため。
    allow_insecure_defaults: bool = False

    # 既定は非公開。/docs と /openapi.json は認証なしで全 API 仕様（パス、
    # パラメータ、スキーマ）を開示するため、攻撃対象領域の地図を無償で配る。
    # docker-compose.yml / docker-compose.production.yml は両方とも明示的に
    # false を渡しているので、この既定値を反転しても既存デプロイの挙動は
    # 変わらない。効くのは compose を経由しない起動（systemd、素の uvicorn、
    # 手元検証）だけで、そこが今まで唯一の穴だった。
    expose_openapi: bool = False

    database_url: str = "postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss"

    # migration ランナー (app/db/migrate.py) が読む SQL ディレクトリ。
    # backend イメージのビルドコンテキストは ./backend なので db/migrations は
    # イメージに含まれない。compose が read-only で bind mount する前提の既定値。
    #
    # `/app` の**外**に置くのが重要。dev の backend は `./backend:/app` を
    # bind mount しているため、その配下へネストさせると Docker がマウント
    # ポイントをホスト側 (`./backend/db/migrations`) に作ってしまう。加えて、
    # mount を書き忘れた場合に `/app` 配下だと「空ディレクトリが存在する」
    # 状態になり、discover() が 0 件を返して静かに成功する。`/app` の外なら
    # 「ディレクトリが無い」になり MigrationError で止まる。
    migrations_dir: str = "/migrations"

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

    # RBAC: "username:role" のカンマ区切りマッピング（role は field / hq / admin）。
    # 未設定のユーザーは default_role になる。M365 認証ではメールアドレス
    # （小文字化済み）が username として一致判定される。
    role_users_raw: str = ""
    default_role: str = "field"

    # AI 利用予算・上限。0 は無制限（既定）。単位は「1 日あたりのリクエスト数」と
    # 「1 か月あたりの総トークン数」で、超過時は 429 を返す。
    ai_max_requests_per_day: int = 0
    ai_max_tokens_per_month: int = 0

    @property
    def auth_required_methods_list(self) -> list[str]:
        """認証を要求する HTTP メソッド。大文字へ正規化する。

        呼び出し側は必ずこの property を使うこと。生の `auth_required_methods`
        （コンマ区切り文字列）に対して `method in ...` を書くと Python の
        部分文字列判定になり、`"T" in "POST,PATCH,PUT,DELETE"` のような
        意図しない一致が成立してしまう。
        """
        return [m.upper() for m in _csv(self.auth_required_methods)]

    @property
    def role_users(self) -> dict[str, str]:
        """username → role の辞書。username は小文字に正規化する。"""
        result: dict[str, str] = {}
        for entry in self.role_users_raw.split(","):
            entry = entry.strip()
            if ":" in entry:
                username, role = entry.split(":", 1)
                role = role.strip().lower()
                if role in ("field", "hq", "admin"):
                    result[username.strip().lower()] = role
        return result

    def role_for(self, username: str) -> str:
        """ユーザーのロールを返す。未設定なら default_role。"""
        return self.role_users.get(username.strip().lower(), self.default_role)

    # auth_exempt_paths は固定値のため list[str] のままとする（env からは設定しない）
    #
    # 重要 — このリストが免除するのは「API キー middleware」だけであり、
    # 「認証」全般ではない。本システムの認証は 2 層に分かれている。
    #
    #   1. API キー層 (app/core/security.py APIKeyMiddleware)
    #      機械間連携向け。`X-API-Key` ヘッダーを検査する。
    #      auth_required_methods (既定 POST,PATCH,PUT,DELETE) のメソッドのみ対象。
    #   2. JWT 層 (app/api/auth.py get_current_user)
    #      ブラウザ利用者向け。route ごとに Depends で個別に適用する。
    #
    # ブラウザは `X-API-Key` を持たないため、WebUI から呼ぶ経路は 1 を免除し、
    # 代わりに 2 を route 側で必ず付ける。**免除するなら JWT を付ける**の対で
    # 運用すること。片方だけだと無認証の穴になる。
    #
    # 下記のうち /auth/login 系だけが本当の無認証（ログイン自体に必要なため）。
    # 残りは全て対応する route に Depends(get_current_user) が付いている。
    auth_exempt_paths: list[str] = [
        "/healthz", "/readyz", "/docs", "/openapi.json", "/metrics",
        # ログイン前に呼ぶ必要があるため、両層とも無認証。
        "/api/v1/auth/login", "/api/v1/auth/login/m365",
        # /ai/* は全て app/api/ai.py 側で JWT を要求する。
        # 従量課金の Anthropic 呼び出しが発生するため、無認証にはできない。
        "/api/v1/ai/analyze",
        "/api/v1/ai/etl-diagnose",
        "/api/v1/ai/risk-summary",
        "/api/v1/ai/report-comment",
        "/api/v1/ai/anomaly-detect",
        "/api/v1/ai/chat",
        # /reports は WebUI のレポート出力。DB は変更しないが監査ログを含む
        # 業務データを書き出すため、app/api/reports.py 側で JWT を要求する。
        "/api/v1/reports",
        # /etl/run/{job_id} は app/api/etl.py 側で JWT を要求する。
        "/api/v1/etl/run",
    ]

    # 本番既定は 60 req/min。0 のまま env 未設定だとログイン総当たりを
    # 止められないため、fail-safe に有効化しておく（開発で無効化したい場合は
    # 明示的に 0 を設定する）。
    rate_limit_per_minute: int = 60
    rate_limit_methods: list[str] = ["POST", "PATCH", "PUT", "DELETE"]
    rate_limit_exempt_paths: list[str] = ["/healthz", "/readyz", "/metrics"]

    # -------------------------------------------------------------------------
    # JWT 認証設定
    # -------------------------------------------------------------------------
    # 既定値はリテラルではなく定数を参照する。app/core/startup.py はこの定数との
    # 一致で「未設定のまま起動しようとしている」を判定するため、両者が別々に
    # 編集されて静かに乖離すると、検査だけが素通りして防御が消える。
    jwt_secret: str = DEV_JWT_SECRET_SENTINEL
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8時間

    # Claude AI API キー (オプション): 設定時は /api/v1/ai/analyze で使用
    claude_api_key: str = ""
    claude_model: str = "claude-sonnet-4-6"
    ai_settings_file: str = "/app/.wmcdss_ai_settings.json"

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
