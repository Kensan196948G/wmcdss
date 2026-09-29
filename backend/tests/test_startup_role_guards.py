"""危険なロール設定・開発用フラグを起動時に可視化する不変条件テスト（task-11 / F10）。

## 背景（verifier の独立検証 task-4）

  - **F-01 [High]**: `docker-compose.yml` が `WMCDSS_DEV_OPEN_ACCESS` の既定を
    `true` で渡していた。この構成（`api_keys` 空 + `dev_open_access=true`）では
    匿名リクエストが admin 相当に戻り、開発スタック（backend は 0.0.0.0:8003、
    frontend は 0.0.0.0:9080 で LAN 公開）経由で無認証の書込が通っていた。
  - **F-03 [Medium]**: `WMCDSS_DEFAULT_ROLE=admin` は `role_users` 未登録ユーザーと
    匿名読み取り身元（`get_current_user_or_anon` の `anon`）を admin にするが、
    起動時監査が出る warning を持っていなかった。
  - **F-04 [Medium]**: `WMCDSS_AUTH_BYPASS_ROLE=admin` は無認証で admin JWT を
    払い出すが、`auth_bypass*` は起動時監査の対象外で何も言わなかった。

## このファイルが固定する性質

1. 開発スタックの **既定値** が「資格情報なし = admin」へ倒れないこと
   （明示 opt-in の口は残す）。
2. 危険なロール設定は起動ログへ必ず warning として残ること。
3. ただし **fatal にはしない**（開発利便を潰さない。既存の分類に合わせる）。

Authorization の意味論（F-02 / F-05 / F-06 / F-07）は Lead の承認事項であり、
このファイルでは一切触れない。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.startup import (
    InsecureConfigurationError,
    audit_security_posture,
    enforce_security_posture,
)

_ROOT = Path(__file__).resolve().parents[2]
_DEV_COMPOSE = _ROOT / "docker-compose.yml"
_PROD_COMPOSE = _ROOT / "docker-compose.production.yml"

# 32 文字以上・番兵値と異なる、テスト用のダミー秘密鍵。
_STRONG_SECRET = "x" * 40


def _settings(**overrides) -> Settings:
    """検査を全て通過する基準設定（= warning ゼロ）を組み立てる。

    `tests/test_startup_security.py::_secure` と同じ意図。ここでは
    「ロール/バイパス由来の warning だけ」を差で見たいので、他の警告要因
    （rate limit 無効・openapi 公開・debug・ログイン手段なし）は全て潰しておく。
    """
    defaults: dict = dict(
        jwt_secret=_STRONG_SECRET,
        api_keys_raw="key-one,key-two",
        rate_limit_per_minute=60,
        expose_openapi=False,
        debug=False,
        local_users="admin:$2b$12$dummyhashdummyhashdummyhashdummyhashdummy",
        default_role="field",
        auth_bypass=False,
        auth_bypass_role="field",
    )
    defaults.update(overrides)
    return Settings(**defaults)


def _role_warnings(**overrides) -> list[str]:
    """ロール/バイパス設定に由来する warning だけを取り出す。"""
    _, warnings = audit_security_posture(_settings(**overrides))
    return [
        w for w in warnings
        if "DEFAULT_ROLE" in w or "AUTH_BYPASS" in w
    ]


# ===========================================================================
# 1. WMCDSS_DEFAULT_ROLE
# ===========================================================================


def test_baseline_settings_produce_no_role_warnings():
    """対照群: 既定（field / bypass なし）ではロール警告が出ないこと。"""
    assert _role_warnings() == []
    fatal, warnings = audit_security_posture(_settings())
    assert fatal == []
    assert warnings == []


def test_default_role_admin_warns():
    """WMCDSS_DEFAULT_ROLE=admin は warning になること。

    未登録ユーザーと匿名読み取り身元が admin 相当になるため、設定した本人が
    忘れても起動ログで気付ける必要がある。
    """
    findings = _role_warnings(default_role="admin")
    assert findings, "default_role=admin で警告が出ていない"
    assert any("WMCDSS_DEFAULT_ROLE" in w for w in findings)
    assert any("field" in w for w in findings), "安全側の値（field）を案内すること"


def test_default_role_field_does_not_warn():
    """既定の field では警告を出さないこと（警告疲れを作らない）。"""
    assert _role_warnings(default_role="field") == []


def test_default_role_hq_is_not_warned_as_admin():
    """hq は admin とは別の警告にしない（契約は admin または未知の値）。"""
    assert _role_warnings(default_role="hq") == []


@pytest.mark.parametrize("bogus", ["superuser", "ADMIN", "", "管理者"])
def test_unknown_default_role_warns(bogus):
    """field/hq/admin 以外の既定ロールは未知の値として警告すること。

    `role_for` は未登録ユーザーに `default_role` をそのまま返すため、未知の値は
    そのまま JWT の `role` クレームへ入る。判定側は field/hq/admin しか知らない。
    """
    findings = _role_warnings(default_role=bogus)
    assert findings, f"default_role={bogus!r} で警告が出ていない"
    assert any("WMCDSS_DEFAULT_ROLE" in w for w in findings)


# ===========================================================================
# 2. WMCDSS_AUTH_BYPASS / WMCDSS_AUTH_BYPASS_ROLE
# ===========================================================================


def test_auth_bypass_warns():
    """auth_bypass=true は（ロールが field でも）warning になること。"""
    findings = _role_warnings(auth_bypass=True)
    assert findings, "auth_bypass=true で警告が出ていない"
    assert any("WMCDSS_AUTH_BYPASS" in w for w in findings)


def test_auth_bypass_field_role_warns_but_is_not_the_privileged_text():
    """field の払い出しは通常警告で、admin 用の強い警告文とは区別できること。"""
    plain = _role_warnings(auth_bypass=True, auth_bypass_role="field")
    privileged = _role_warnings(auth_bypass=True, auth_bypass_role="admin")
    assert plain and privileged
    assert plain != privileged, (
        "auth_bypass_role=field と admin で同じ文になっている。"
        "無認証で管理者権限が配られる状態が通常の警告に埋もれる。"
    )


@pytest.mark.parametrize("role", ["admin", "hq"])
def test_auth_bypass_privileged_role_warns_stronger(role):
    """admin / hq を配るバイパスは、より強い警告（資格情報なしでその権限）になること。"""
    findings = _role_warnings(auth_bypass=True, auth_bypass_role=role)
    assert findings, f"auth_bypass_role={role} で警告が出ていない"
    strong = [w for w in findings if role in w]
    assert strong, f"auth_bypass_role={role} を名指しした警告が無い: {findings}"
    assert any("資格情報なし" in w for w in strong), (
        "無認証でそのロールの JWT が配られることが読み取れない"
    )


def test_auth_bypass_role_demoted_to_default_role_is_judged_by_effective_role():
    """未知の auth_bypass_role は default_role へ降格される（api/auth.py と同じ規則）。

    そのため `auth_bypass_role="superuser"` + `default_role="admin"` は
    実際には admin JWT を配る。設定値だけを見る実装はこれを見落とす。
    """
    findings = _role_warnings(auth_bypass=True, auth_bypass_role="superuser", default_role="admin")
    assert findings
    assert any("admin" in w and "資格情報なし" in w for w in findings), (
        f"降格後に admin が配られる状態を検出していない: {findings}"
    )


def test_auth_bypass_disabled_does_not_warn():
    """auth_bypass=false では警告を出さないこと。"""
    assert _role_warnings(auth_bypass=False, auth_bypass_role="admin") == []


# ===========================================================================
# 3. fatal にはしない（起動を止めない）
# ===========================================================================


def test_privileged_role_settings_are_warnings_not_fatal():
    """危険なロール/バイパス設定でも起動は止めないこと。

    これらは最終的に人間が決める設定であり、fatal にすると開発スタックが
    起動しなくなる。可視化（warning）と起動可否は分けて扱う。
    """
    fatal, warnings = audit_security_posture(
        _settings(default_role="admin", auth_bypass=True, auth_bypass_role="admin")
    )
    assert fatal == [], "ロール設定は fatal にしてはならない"
    assert warnings, "警告は出さなければならない"
    # 例外を投げないこと（= 起動できること）も実際に確認する。
    enforce_security_posture(
        _settings(default_role="admin", auth_bypass=True, auth_bypass_role="admin")
    )


def test_fatal_path_still_raises_after_the_new_checks():
    """新しい warning を足しても fatal の判定自体は変わっていないこと。"""
    with pytest.raises(InsecureConfigurationError):
        enforce_security_posture(_settings(api_keys_raw="", default_role="admin"))


# ===========================================================================
# 4. docker-compose の既定値（F-01 の再発防止）
#
# 「既定で fail-open に戻らない」ことをリポジトリのファイル内容に対して固定する。
# YAML パーサに依存させない（PyYAML は pyproject の依存に無く、CI 環境で
# 不在になり得るため）。テキストとしての機械検査で十分に再発を防げる。
# ===========================================================================

_DEV_OPEN_ACCESS_ASSIGNMENT = re.compile(
    r"^\s*WMCDSS_DEV_OPEN_ACCESS:\s*(?P<value>.+?)\s*$"
)
_SHELL_DEFAULT = re.compile(r"\$\{WMCDSS_DEV_OPEN_ACCESS:-(?P<default>[^}]*)\}")


def _dev_open_access_assignments(text: str) -> list[str]:
    values = []
    for line in text.splitlines():
        m = _DEV_OPEN_ACCESS_ASSIGNMENT.match(line)
        if m:
            values.append(m.group("value"))
    return values


def test_dev_compose_keeps_the_explicit_opt_in_knob():
    """明示 opt-in の口は残すこと（削除して『設定しても効かない』状態にしない）。"""
    values = _dev_open_access_assignments(_DEV_COMPOSE.read_text(encoding="utf-8"))
    assert values, "docker-compose.yml から WMCDSS_DEV_OPEN_ACCESS が消えている"


def test_dev_compose_default_does_not_enable_open_access():
    """開発スタックの既定で『資格情報なし = admin』に戻らないこと（F-01）。

    `docker-compose.yml` は backend を 0.0.0.0:8003、frontend を 0.0.0.0:9080 で
    公開する。既定が true だと、LAN から到達できる開発スタックで無認証の書込が
    通る（verifier が in-process で fail-open の再現を実測している）。
    """
    values = _dev_open_access_assignments(_DEV_COMPOSE.read_text(encoding="utf-8"))
    assert values
    for value in values:
        m = _SHELL_DEFAULT.search(value)
        assert m, (
            f"WMCDSS_DEV_OPEN_ACCESS の既定値の書き方が想定外: {value!r}。"
            "'${WMCDSS_DEV_OPEN_ACCESS:-false}' の形にすること。"
        )
        default = m.group("default").strip()
        assert default != "true", (
            f"開発スタックの既定が true に戻っている: {value!r}。"
            "匿名リクエストが admin 相当になり、無認証の書込が通る。"
        )
        assert default == "false", f"既定は false にすること: {value!r}"


def test_production_compose_never_sets_open_access():
    """本番 compose が WMCDSS_DEV_OPEN_ACCESS を渡さないこと（= アプリ既定 false）。"""
    for line in _PROD_COMPOSE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        assert "WMCDSS_DEV_OPEN_ACCESS" not in stripped, (
            f"本番 compose が開発用フラグを設定している: {stripped!r}"
        )
