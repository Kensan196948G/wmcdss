"""起動時セキュリティ設定検証 (app/core/startup.py) のテスト。

守りたい性質は 2 つ。

  1. 危険な既定値のまま本番が起動できないこと (fail-closed)。
  2. その判定を `allow_insecure_defaults` で降格できるが、**明示的に設定した
     ときだけ**であること。既定では降格しない。

`audit_security_posture` は純粋関数なので、例外を挟まず「何を検出したか」を
直接検証する。`enforce_security_posture` 側では raise / 非 raise の分岐だけを
確認し、判定内容の重複検証はしない。
"""
from __future__ import annotations

import pytest

from app.core.config import DEV_JWT_SECRET_SENTINEL, Settings
from app.core.startup import (
    InsecureConfigurationError,
    audit_security_posture,
    enforce_security_posture,
)

# 32 文字以上・番兵値と異なる、テスト用のダミー秘密鍵。
_STRONG_SECRET = "x" * 40


def _secure(**overrides) -> Settings:
    """検査を全て通過する設定を組み立てる。"""
    defaults: dict = dict(
        jwt_secret=_STRONG_SECRET,
        api_keys_raw="key-one,key-two",
        rate_limit_per_minute=60,
        expose_openapi=False,
        debug=False,
        local_users="admin:$2b$12$dummyhashdummyhashdummyhashdummyhashdummy",
    )
    defaults.update(overrides)
    return Settings(**defaults)


# ---------------------------------------------------------------------------
# audit_security_posture — 致命的な検出
# ---------------------------------------------------------------------------


def test_secure_settings_produce_no_findings():
    fatal, warnings = audit_security_posture(_secure())
    assert fatal == []
    assert warnings == []


def test_default_jwt_secret_is_fatal():
    fatal, _ = audit_security_posture(_secure(jwt_secret=DEV_JWT_SECRET_SENTINEL))
    assert len(fatal) == 1
    assert "WMCDSS_JWT_SECRET" in fatal[0]


def test_short_jwt_secret_is_fatal():
    fatal, _ = audit_security_posture(_secure(jwt_secret="short"))
    assert len(fatal) == 1
    assert "WMCDSS_JWT_SECRET" in fatal[0]


def test_jwt_secret_exactly_at_minimum_is_accepted():
    # 境界値: 32 文字ちょうどは許容する (未満のみ fatal)。
    fatal, _ = audit_security_posture(_secure(jwt_secret="a" * 32))
    assert fatal == []


def test_empty_api_keys_is_fatal():
    fatal, _ = audit_security_posture(_secure(api_keys_raw=""))
    assert len(fatal) == 1
    assert "WMCDSS_API_KEYS_RAW" in fatal[0]


def test_multiple_fatal_findings_are_all_reported():
    # 1 件目で打ち切らず全件返すこと — 運用者が一度の起動失敗で
    # 全ての不備を把握できるようにするため。
    fatal, _ = audit_security_posture(
        _secure(jwt_secret=DEV_JWT_SECRET_SENTINEL, api_keys_raw="")
    )
    assert len(fatal) == 2


def test_findings_never_contain_the_secret_value():
    # 検出メッセージが秘密値そのものを含むと、ログや CI 出力へ漏れる。
    secret = "s3cret-value-that-must-not-leak-anywhere-0123"
    fatal, warnings = audit_security_posture(_secure(jwt_secret=secret, api_keys_raw=""))
    assert all(secret not in m for m in fatal + warnings)


# ---------------------------------------------------------------------------
# audit_security_posture — 警告どまりの検出
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "override,needle",
    [
        ({"rate_limit_per_minute": 0}, "RATE_LIMIT"),
        ({"expose_openapi": True}, "EXPOSE_OPENAPI"),
        ({"debug": True}, "DEBUG"),
        ({"local_users": ""}, "Entra"),
    ],
)
def test_non_fatal_settings_warn_but_do_not_block(override, needle):
    fatal, warnings = audit_security_posture(_secure(**override))
    assert fatal == [], "起動を止めるほどの問題ではない"
    assert any(needle in w for w in warnings)


# ---------------------------------------------------------------------------
# enforce_security_posture — raise するかどうか
# ---------------------------------------------------------------------------


def test_enforce_raises_on_fatal_by_default():
    with pytest.raises(InsecureConfigurationError):
        enforce_security_posture(_secure(api_keys_raw=""))


def test_enforce_passes_on_secure_settings():
    enforce_security_posture(_secure())  # 例外が出ないこと


def test_enforce_does_not_raise_on_warnings_only():
    enforce_security_posture(_secure(expose_openapi=True, rate_limit_per_minute=0))


def test_allow_insecure_defaults_downgrades_fatal_to_warning():
    # 開発環境の逃げ道。明示的に設定したときだけ効く。
    enforce_security_posture(
        _secure(
            jwt_secret=DEV_JWT_SECRET_SENTINEL,
            api_keys_raw="",
            allow_insecure_defaults=True,
        )
    )


def test_allow_insecure_defaults_is_false_by_default():
    # 既定が True だと「フラグを設定し忘れた本番」が危険側へ倒れる。
    # この既定値そのものが防御なので、明示的に固定する。
    assert Settings().allow_insecure_defaults is False


def test_openapi_is_not_exposed_by_default():
    # 同上。compose は両系とも false を明示しているが、compose を経由しない
    # 起動 (systemd、素の uvicorn) では既定値がそのまま効く。
    assert Settings().expose_openapi is False


def test_default_settings_are_rejected_by_the_audit():
    # 総合ガード: 「何も設定しない」状態は必ず fatal になること。
    # 個別の既定値を 1 つずつ固定するだけでは、新しい fail-open な設定項目が
    # 追加されたときに素通りする。ここは「素の Settings() で起動できない」
    # という性質そのものを固定する。
    fatal, _ = audit_security_posture(Settings())
    assert fatal, "既定値のままでは起動できないこと"


def test_enforce_error_message_lists_every_finding():
    with pytest.raises(InsecureConfigurationError) as exc:
        enforce_security_posture(
            _secure(jwt_secret=DEV_JWT_SECRET_SENTINEL, api_keys_raw="")
        )
    message = str(exc.value)
    assert "WMCDSS_JWT_SECRET" in message
    assert "WMCDSS_API_KEYS_RAW" in message
    # 解決方法を必ず添える — 起動できない運用者が次に何をすべきか分かるように。
    assert "WMCDSS_ALLOW_INSECURE_DEFAULTS" in message
