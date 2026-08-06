"""起動時セキュリティ設定検証。

本システムの認証は、設定し忘れたときに**静かに無効化される**構造になっていた。

  - `jwt_secret` の既定値はリポジトリに書かれた公開文字列であり、未設定のまま
    本番が起動すると誰でも任意ユーザーのトークンを偽造できる。
  - `api_keys_raw` が空だと `APIKeyMiddleware` が最初の分岐で素通りし、
    観測値の upsert を含む全ての変更系リクエストが無認証で通る。

どちらも「エラーが出ないまま防御だけが消える」= fail-open であり、運用中に
気付く手段がない。そこでプロセス起動時に設定を検査し、危険な状態なら
**起動を拒否する**（fail-closed）。

開発環境は `WMCDSS_ALLOW_INSECURE_DEFAULTS=true` で明示的にこの検証を降格
できる。既定は False なので、「何も設定しなかった環境」は安全側に倒れる。
逆にすると、フラグを設定し忘れた本番が危険側に倒れてしまう。

検証メッセージには秘密値そのものを含めない。ログや CI 出力へ秘密が漏れる
経路を作らないため、常に「何が問題か」だけを述べる。
"""
from __future__ import annotations

import logging

from app.core.config import DEV_JWT_SECRET_SENTINEL, Settings

log = logging.getLogger(__name__)

# RFC 7518 (JSON Web Algorithms) §3.2 は HMAC について
# 「ハッシュ出力と同じサイズ (HS256 なら 256 bit) 以上の鍵を MUST 使用する」と
# 規定している。つまりこれは推奨値ではなく仕様要件であり、下回る鍵は
# 総当たり耐性が署名アルゴリズムの想定を満たさない。
# PyJWT 2.10+ も同じ根拠で InsecureKeyLengthWarning を出す。
MIN_JWT_SECRET_LEN = 32


class InsecureConfigurationError(RuntimeError):
    """本番相当の設定に、認証を無効化する既定値が残っている。"""


def audit_security_posture(s: Settings) -> tuple[list[str], list[str]]:
    """設定を検査して ``(fatal, warnings)`` を返す。副作用なし。

    純粋関数として切り出してあるのは、テストが例外処理を挟まずに
    「何が検出されるか」を直接検証できるようにするため。
    """
    fatal: list[str] = []
    warnings: list[str] = []

    # --- 認証を無効化する設定 = fatal --------------------------------------
    if s.jwt_secret == DEV_JWT_SECRET_SENTINEL:
        fatal.append(
            "WMCDSS_JWT_SECRET が開発用の既定値のままです。この値はリポジトリに"
            "公開されているため、任意ユーザーの JWT を第三者が偽造できます。"
            f"{MIN_JWT_SECRET_LEN} 文字以上のランダム文字列を設定してください "
            "(例: `openssl rand -base64 48`)。"
        )
    elif len(s.jwt_secret) < MIN_JWT_SECRET_LEN:
        fatal.append(
            f"WMCDSS_JWT_SECRET が短すぎます (要 {MIN_JWT_SECRET_LEN} 文字以上)。"
            "HS256 の署名強度は鍵のエントロピーで決まるため、短い鍵は総当たりで"
            "破られトークン偽造につながります。"
        )

    if not s.api_keys:
        fatal.append(
            "WMCDSS_API_KEYS_RAW が空です。APIKeyMiddleware は API キー未設定時に"
            "認証を丸ごとスキップするため、観測値の投入を含む全ての変更系"
            "リクエストが無認証で通ります。"
        )

    # --- 防御力は下がるが起動は妨げない設定 = warning -----------------------
    if s.rate_limit_per_minute <= 0:
        warnings.append(
            "WMCDSS_RATE_LIMIT_PER_MINUTE が 0 以下のためレート制限が無効です。"
            "総当たりログインと大量投入を抑止できません。"
        )

    if s.expose_openapi:
        warnings.append(
            "WMCDSS_EXPOSE_OPENAPI が有効です。/docs と /openapi.json が"
            "無認証で全 API 仕様を公開します。"
        )

    if s.debug:
        warnings.append("WMCDSS_DEBUG が有効です。本番では無効にしてください。")

    if not s.local_users_dict() and not s.entra_enabled:
        warnings.append(
            "ローカルユーザーも Entra ID も未設定です。誰もログインできないため、"
            "JWT で保護された管理機能に到達できません。"
        )

    return fatal, warnings


def enforce_security_posture(s: Settings) -> None:
    """設定を検査し、致命的な問題があれば起動を中止する。

    ``allow_insecure_defaults`` が True のときは致命的な問題も警告へ降格する。
    その場合でも黙認せず、何を無視して起動したかを必ずログへ残す。
    """
    fatal, warnings = audit_security_posture(s)

    for w in warnings:
        log.warning("security posture: %s", w)

    if not fatal:
        if not warnings:
            log.info("security posture: 検査項目に問題は見つかりませんでした。")
        return

    if s.allow_insecure_defaults:
        for f in fatal:
            log.warning("security posture [DEV OVERRIDE]: %s", f)
        log.warning(
            "WMCDSS_ALLOW_INSECURE_DEFAULTS=true のため、上記 %d 件の致命的な"
            "設定不備を無視して起動します。本番環境では絶対に設定しないでください。",
            len(fatal),
        )
        return

    detail = "\n".join(f"  - {f}" for f in fatal)
    raise InsecureConfigurationError(
        f"安全でない設定のため起動を中止しました ({len(fatal)} 件):\n{detail}\n"
        "  開発環境で意図的にこの検査を無効化する場合は "
        "WMCDSS_ALLOW_INSECURE_DEFAULTS=true を設定してください。"
    )
