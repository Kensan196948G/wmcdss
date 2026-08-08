"""app/db/migrate.py の純関数テスト。

DB へは接続しない。判断ロジック（何を適用するか / 何を止めるか）を `build_plan`
に閉じてあるため、ここだけで migration の意味論を検証できる。DB I/O を含む
`_apply` / `_run` は `backend / api smoke` の live compose 側で検証する。
"""

import pytest

from app.db.migrate import (
    Migration,
    MigrationError,
    asyncpg_dsn,
    build_plan,
    checksum_of,
    discover,
)


def _m(version: str, body: str = "SELECT 1;") -> Migration:
    return Migration(version=version, body=body)


def _write(directory, name: str, body: str = "SELECT 1;") -> None:
    (directory / name).write_text(body, encoding="utf-8")


# ---------------------------------------------------------------------------
# checksum
# ---------------------------------------------------------------------------


def test_checksum_is_stable_across_line_endings():
    """CRLF / LF の差で checksum が変わってはならない。

    変わると、内容が同一なのに「適用済み migration が改竄された」と判定され、
    チェックアウト環境が違うだけでデプロイが止まる。
    """
    assert checksum_of("CREATE TABLE a();\nSELECT 1;\n") == checksum_of(
        "CREATE TABLE a();\r\nSELECT 1;\r\n"
    )


def test_checksum_detects_content_change():
    assert checksum_of("SELECT 1;") != checksum_of("SELECT 2;")


# ---------------------------------------------------------------------------
# discover
# ---------------------------------------------------------------------------


def test_discover_orders_numerically_not_lexicographically(tmp_path):
    """`10_` は `2_` より後に来なければならない。

    このテストは辞書順と数値順で**逆の結果**になる値を選んでいる。`0001`/`0002`
    のようにゼロ詰めが揃った例だけで書くと、両方の解釈が一致してしまい、
    並び順が壊れてもテストは緑のままになる。
    """
    _write(tmp_path, "2_second.sql")
    _write(tmp_path, "10_tenth.sql")
    _write(tmp_path, "1_first.sql")

    assert [m.version for m in discover(tmp_path)] == [
        "1_first.sql",
        "2_second.sql",
        "10_tenth.sql",
    ]


def test_discover_rejects_files_without_numeric_prefix(tmp_path):
    """規則外の `.sql` を黙って無視しない。

    無視すると「置いたのに適用されない」という、最も気付きにくい失敗になる。
    """
    _write(tmp_path, "0001_init.sql")
    _write(tmp_path, "hotfix.sql")

    with pytest.raises(MigrationError, match="hotfix.sql"):
        discover(tmp_path)


def test_discover_rejects_duplicate_numbers(tmp_path):
    """同じ番号が 2 つあると適用順が一意に決まらない。"""
    _write(tmp_path, "0003_add_column.sql")
    _write(tmp_path, "0003_add_index.sql")

    with pytest.raises(MigrationError, match="0003"):
        discover(tmp_path)


def test_discover_errors_when_directory_missing(tmp_path):
    """ディレクトリが無い場合に「適用対象 0 件」で成功扱いにしない。

    マウント忘れは実際に起きる。空ディレクトリとして扱うと、スキーマが無いまま
    デプロイが「成功」する。
    """
    with pytest.raises(MigrationError, match="存在しない"):
        discover(tmp_path / "not-there")


def test_discover_errors_when_directory_is_empty(tmp_path):
    """`.sql` が 1 件も無い場合も失敗にする。

    ディレクトリ非存在だけを弾いても穴が残る。compose のホスト側パスを打ち
    間違えると Docker が**空ディレクトリを作って**マウントするため、0 件を
    成功として通すと「スキーマが無いままデプロイ成功」になる。この機能が
    防ごうとしている失敗そのものなので、ここで止める。
    """
    (tmp_path / "README.md").write_text("notes", encoding="utf-8")

    with pytest.raises(MigrationError, match="1 件も無い"):
        discover(tmp_path)


def test_discover_ignores_non_sql_files(tmp_path):
    _write(tmp_path, "0001_init.sql")
    (tmp_path / "README.md").write_text("notes", encoding="utf-8")

    assert [m.version for m in discover(tmp_path)] == ["0001_init.sql"]


def test_discover_reads_body_for_checksum(tmp_path):
    _write(tmp_path, "0001_init.sql", "CREATE TABLE sites ();")
    (migration,) = discover(tmp_path)

    assert migration.body == "CREATE TABLE sites ();"
    assert migration.checksum == checksum_of("CREATE TABLE sites ();")


# ---------------------------------------------------------------------------
# build_plan
# ---------------------------------------------------------------------------


def test_plan_on_fresh_database_applies_everything():
    """スキーマも記録も無い = 新規 DB。0001 から全て適用する。"""
    discovered = [_m("0001_init.sql"), _m("0002_seed.sql")]

    plan = build_plan(discovered, applied={}, schema_present=False)

    assert plan.needs_baseline is False
    assert [m.version for m in plan.pending] == ["0001_init.sql", "0002_seed.sql"]


def test_plan_on_initdb_database_demands_baseline():
    """スキーマはあるが記録が無い = initdb 経路で作られた既存 DB。

    どのファイルが適用済みかは DB からは判定できない。推測して自動 baseline
    すると、未適用の migration を「適用済み」と誤記録してスキーマ乖離が起きる。
    よって何も適用せず、運用者へ委ねる（fail-closed）。
    """
    discovered = [_m("0001_init.sql"), _m("0002_seed.sql")]

    plan = build_plan(discovered, applied={}, schema_present=True)

    assert plan.needs_baseline is True
    assert plan.pending == ()


def test_plan_applies_only_the_unapplied_tail():
    m1, m2, m3 = _m("0001_init.sql"), _m("0002_seed.sql"), _m("0003_add.sql")
    applied = {m1.version: m1.checksum, m2.version: m2.checksum}

    plan = build_plan([m1, m2, m3], applied=applied, schema_present=True)

    assert [m.version for m in plan.pending] == ["0003_add.sql"]
    assert plan.needs_baseline is False


def test_plan_detects_modified_applied_migration():
    """適用済みファイルが書き換えられたら検出する。

    DB には旧版が当たっているのにファイルは新版、という状態で先へ進むと、
    以後どの版が実際に当たっているのか誰にも分からなくなる。
    """
    original = _m("0001_init.sql", "CREATE TABLE a ();")
    edited = _m("0001_init.sql", "CREATE TABLE a (id int);")

    plan = build_plan([edited], applied={"0001_init.sql": original.checksum}, schema_present=True)

    assert plan.drifted == ("0001_init.sql",)


def test_modified_applied_migration_is_not_re_applied():
    """改竄検出は「再適用」ではない。

    pending に混ぜてしまうと、既に当たっている DDL がもう一度流れて
    `relation already exists` で落ちる。止めるのが正しい。
    """
    edited = _m("0001_init.sql", "CREATE TABLE a (id int);")

    plan = build_plan(
        [edited],
        applied={"0001_init.sql": checksum_of("CREATE TABLE a ();")},
        schema_present=True,
    )

    assert plan.pending == ()


def test_plan_reports_records_without_files():
    """記録はあるがファイルが無い版を可視化する。

    DB の状態自体は正しい（その migration は実際に流れた）ので失敗にはしない。
    ただし checksum を検証できない事実は隠さない。
    """
    m2 = _m("0002_seed.sql")

    plan = build_plan(
        [m2],
        applied={"0001_init.sql": "deadbeef", m2.version: m2.checksum},
        schema_present=True,
    )

    assert plan.orphaned == ("0001_init.sql",)
    assert plan.pending == ()
    assert plan.drifted == ()


def test_plan_is_idempotent_when_everything_is_applied():
    m1 = _m("0001_init.sql")

    plan = build_plan([m1], applied={m1.version: m1.checksum}, schema_present=True)

    assert plan == build_plan([m1], applied={m1.version: m1.checksum}, schema_present=True)
    assert plan.pending == ()
    assert plan.drifted == ()
    assert plan.orphaned == ()
    assert plan.needs_baseline is False


# ---------------------------------------------------------------------------
# asyncpg_dsn
# ---------------------------------------------------------------------------


def test_asyncpg_dsn_drops_the_sqlalchemy_driver_token():
    """asyncpg は `postgresql+asyncpg` という driver 名を受け付けない。"""
    assert asyncpg_dsn("postgresql+asyncpg://u:pw@db:5432/wmcdss").startswith("postgresql://")
    assert "+asyncpg" not in asyncpg_dsn("postgresql+asyncpg://u:pw@db:5432/wmcdss")


def test_asyncpg_dsn_preserves_host_port_and_database():
    dsn = asyncpg_dsn("postgresql+asyncpg://wmcdss_app:pw@db:5432/wmcdss")

    assert "@db:5432/wmcdss" in dsn
    assert "wmcdss_app" in dsn


def test_asyncpg_dsn_keeps_percent_encoded_password_intact():
    """`@` や `/` を含むパスワードは URL エンコードされて渡ってくる。

    単純な文字列置換で driver 名を落とす実装だとここは通るが、URL を素朴に
    分解する実装では認証情報が壊れて接続できなくなる。値そのものはテスト用の
    ダミーで、実在の資格情報ではない。
    """
    dsn = asyncpg_dsn("postgresql+asyncpg://u:a%40b%2Fc@db:5432/wmcdss")

    assert "a%40b%2Fc" in dsn
