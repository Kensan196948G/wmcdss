"""再実行可能な SQL migration ランナー。

## なぜ必要か

従来 `db/migrations/*.sql` は、compose が postgres 公式イメージの
`/docker-entrypoint-initdb.d` へマウントするだけだった。しかし公式 entrypoint は
`$PGDATA/PG_VERSION` の存在を見て初期化を丸ごと飛ばす（`docker-entrypoint.sh`:
`PostgreSQL Database directory appears to contain a database; Skipping
initialization`）。したがって **初回デプロイ以降に追加した migration は本番へ
二度と届かない**。

これは「デプロイは成功したのにスキーマが古いまま」という形で失敗する。アプリは
起動し、ヘルスチェックも通り、存在しない列を触った経路だけが実行時に落ちる。
静かに壊れる種類の障害なので、版管理付きのランナーを**唯一の適用経路**にする。

## 設計

- 適用済みの版は `schema_migrations` に記録する。記録には checksum を含め、
  適用済みファイルが後から書き換えられた場合は**適用を止める**。DB と repo が
  乖離したまま進むと、以後どの版が本当に当たっているのか誰にも分からなくなる。
- 1 ファイル = 1 トランザクション。途中で失敗したら残りを実行せずに止める
  （CLAUDE.md §13「migration 失敗時に継続実行せず、データ整合性を確認する」）。
- advisory lock を取る。ローリングデプロイで 2 つのランナーが同時に走ると、
  同じ DDL が二重に流れる。
- 判断ロジック（`build_plan`）は DB へ触らない純関数にしてある。本リポジトリの
  CI は `backend / pure-function tests`（DB 不要）と `backend / api smoke`
  （live compose）を分けており、`services/decision.py` と同じ分割に揃えている。

## initdb 由来の既存 DB について

このランナーを導入する前に initdb 経路で作られた DB は、スキーマがあるのに
`schema_migrations` が空になる。この状態でどのファイルが既に当たっているかは
**DB からは判定できない**（initdb はその時点でディレクトリにあった全ファイルを
実行しており、その集合は記録されていない）。

推測して自動 baseline すると、本当に未適用の migration を「適用済み」と誤って
記録しうる。それは静かなスキーマ乖離そのものなので、ここでは fail-closed とし、
運用者へ明示的な `baseline` 実行を要求する。
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import asyncpg
from sqlalchemy.engine import make_url

from app.core.config import get_settings

MIGRATIONS_TABLE = "schema_migrations"

# advisory lock のキー。セッション単位のロックで、同時に走るランナーを 1 つに
# 絞る。値そのものに意味は無いが、他システムと衝突しないよう固定値を明示する。
ADVISORY_LOCK_KEY = 5_271_070_116

# `0001_init.sql` のような名前だけを受け付ける。数値接頭辞を必須にするのは、
# 適用順を**ファイル名の辞書順ではなく数値順**で決めるため。辞書順に頼ると
# `10_x.sql` が `2_x.sql` より前に来て、依存関係のある DDL が壊れる。
_NAME_RE = re.compile(r"^(\d+)_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$")

_CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {MIGRATIONS_TABLE} (
    version    text        PRIMARY KEY,
    checksum   text        NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by text        NOT NULL DEFAULT current_user
)
"""


class MigrationError(RuntimeError):
    """運用者の対応が必要な状態。メッセージはそのまま標準エラーへ出す。"""


@dataclass(frozen=True)
class Migration:
    """1 つの migration ファイル。

    `body` を保持するのは、checksum を計算した瞬間と実際に適用する瞬間で
    ファイルの内容が食い違わないようにするため。読み直す実装だと、記録される
    checksum と実際に流れた SQL が別物になりうる。
    """

    version: str
    body: str

    @property
    def checksum(self) -> str:
        return checksum_of(self.body)

    @property
    def order_key(self) -> tuple[int, str]:
        m = _NAME_RE.match(self.version)
        # discover() が検証済みのため None にはならない。手で構築した場合の保険。
        return (int(m.group(1)), self.version) if m else (0, self.version)


@dataclass(frozen=True)
class Plan:
    """適用計画。`build_plan` が返す純粋な値。"""

    pending: tuple[Migration, ...] = ()
    # 適用済みとして記録されているが、ファイルの内容が当時と違うもの。
    drifted: tuple[str, ...] = ()
    # DB に記録があるがファイルが見つからないもの。DB の状態自体は正しいので
    # 失敗にはしないが、checksum を検証できない事実は必ず表示する。
    orphaned: tuple[str, ...] = ()
    # initdb 由来の既存 DB。運用者による一度きりの `baseline` が必要。
    needs_baseline: bool = False


def checksum_of(body: str) -> str:
    """SQL 本文の SHA-256。

    改行コードを LF へ正規化してから計算する。チェックアウト環境の差
    （`core.autocrlf` 等）だけで checksum がぶれると、内容は同一なのに
    「改竄された」と判定されてデプロイが止まる。
    """
    return hashlib.sha256(body.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def discover(directory: Path) -> list[Migration]:
    """`directory` 直下の migration を数値接頭辞の昇順で返す。

    命名規則に合わない `.sql` があれば例外にする。黙って無視すると、
    「置いたのに適用されない」という最も気付きにくい失敗になる。
    """
    if not directory.is_dir():
        raise MigrationError(f"migration ディレクトリが存在しない: {directory}")

    found = sorted(p for p in directory.glob("*.sql") if p.is_file())
    # 0 件は「本当に何も無い」ではなく「マウント先を間違えた」を意味する。
    # このリポジトリには常に 0001_init.sql がある。compose のホスト側パスを
    # 打ち間違えると Docker が空ディレクトリを作って mount するため、0 件を
    # 成功として通すと「スキーマが無いままデプロイ成功」になる。
    if not found:
        raise MigrationError(
            f"migration ファイルが 1 件も無い: {directory}\n"
            "マウント設定（compose の volumes / --dir）を確認すること。"
        )

    bad = [p.name for p in found if not _NAME_RE.match(p.name)]
    if bad:
        raise MigrationError(
            "命名規則に合わない migration がある（`0001_name.sql` 形式が必須）: "
            + ", ".join(bad)
        )

    migrations = [Migration(version=p.name, body=p.read_text(encoding="utf-8")) for p in found]
    migrations.sort(key=lambda m: m.order_key)

    duplicates = _duplicate_prefixes(migrations)
    if duplicates:
        raise MigrationError(
            "同じ番号の migration が複数ある（適用順が一意に決まらない）: "
            + ", ".join(duplicates)
        )
    return migrations


def _duplicate_prefixes(migrations: list[Migration]) -> list[str]:
    seen: dict[int, str] = {}
    dupes: list[str] = []
    for m in migrations:
        number = m.order_key[0]
        if number in seen:
            dupes.append(f"{seen[number]} / {m.version}")
        else:
            seen[number] = m.version
    return dupes


def build_plan(
    discovered: list[Migration],
    applied: dict[str, str],
    schema_present: bool,
) -> Plan:
    """適用計画を組み立てる純関数。DB へは触らない。

    `applied` は `{version: checksum}`。`schema_present` は「0001 が作る中核
    テーブルが既に存在するか」。
    """
    # 記録は無いのにスキーマだけある = initdb 経路で作られた DB。どのファイルが
    # 当たっているか DB からは分からないため、推測せず運用者へ委ねる。
    if not applied and schema_present:
        return Plan(needs_baseline=True)

    pending = tuple(m for m in discovered if m.version not in applied)
    drifted = tuple(
        m.version
        for m in discovered
        if m.version in applied and applied[m.version] != m.checksum
    )
    known = {m.version for m in discovered}
    orphaned = tuple(sorted(v for v in applied if v not in known))
    return Plan(pending=pending, drifted=drifted, orphaned=orphaned)


def asyncpg_dsn(database_url: str) -> str:
    """SQLAlchemy DSN を asyncpg が解釈できる DSN へ変換する。

    設定値は `postgresql+asyncpg://...`（SQLAlchemy 形式）で、asyncpg は
    `+asyncpg` 付きの driver 名を受け付けない。文字列置換ではなく `make_url`
    で解析するのは、URL エンコードされたパスワード（`@` や `/` を含む）を
    壊さないため。

    戻り値にはパスワードが含まれる。**ログ・例外メッセージ・標準出力へ出さない
    こと。** 本モジュールは接続時にのみ使用し、どこにも表示しない。
    """
    return make_url(database_url).set(drivername="postgresql").render_as_string(
        hide_password=False
    )


async def _fetch_applied(conn: asyncpg.Connection) -> dict[str, str]:
    rows = await conn.fetch(f"SELECT version, checksum FROM {MIGRATIONS_TABLE}")
    return {r["version"]: r["checksum"] for r in rows}


async def _schema_present(conn: asyncpg.Connection) -> bool:
    """0001 が作る中核テーブルが既にあるか。

    `sites` を代表として見る。0001 が最初に作る業務テーブルであり、これが
    存在するなら 0001 は当たっている。
    """
    return bool(await conn.fetchval("SELECT to_regclass('public.sites') IS NOT NULL"))


async def _apply(conn: asyncpg.Connection, migration: Migration) -> None:
    """1 つの migration を 1 トランザクションで適用し、記録する。

    SQL 本文と記録の INSERT を同じトランザクションに入れるのが要点。分けると
    「DDL は通ったが記録に失敗」した瞬間に、次回の実行で同じ DDL が再度流れる。
    """
    async with conn.transaction():
        # 引数なしの execute() は simple query protocol を使うため、1 ファイル内の
        # 複数文をそのまま実行できる。引数付き（prepared statement）にすると
        # "cannot insert multiple commands into a prepared statement" で落ちる。
        await conn.execute(migration.body)
        await conn.execute(
            f"INSERT INTO {MIGRATIONS_TABLE} (version, checksum) VALUES ($1, $2)",
            migration.version,
            migration.checksum,
        )


def _report(plan: Plan, discovered: list[Migration], applied: dict[str, str]) -> None:
    print(f"検出: {len(discovered)} 件 / 適用済み: {len(applied)} 件 / 未適用: {len(plan.pending)} 件")
    for m in plan.pending:
        print(f"  未適用  {m.version}")
    for v in plan.orphaned:
        print(f"  記録のみ {v}  (ファイルが見つからず checksum を検証できない)", file=sys.stderr)


def _baseline_message() -> str:
    return (
        "DB にスキーマが存在するのに migration の適用記録が無い。\n"
        "これは、このランナー導入前に docker-entrypoint-initdb.d 経路で作られた\n"
        "DB の状態である。どのファイルが既に適用済みかは DB からは判定できないため、\n"
        "自動では進めない（誤って『適用済み』と記録するとスキーマ乖離が起きる）。\n"
        "\n"
        "現在の migration ファイル群が全て適用済みであることを確認したうえで、\n"
        "一度だけ次を実行すること:\n"
        "    python -m app.db.migrate baseline\n"
    )


async def _run(directory: Path, command: str) -> int:
    discovered = discover(directory)
    conn = await asyncpg.connect(asyncpg_dsn(get_settings().database_url))
    try:
        await conn.execute(_CREATE_TABLE_SQL)
        # ロックはセッション単位。同時に走った 2 本目はここで待つ。
        await conn.execute("SELECT pg_advisory_lock($1)", ADVISORY_LOCK_KEY)
        try:
            applied = await _fetch_applied(conn)
            plan = build_plan(discovered, applied, await _schema_present(conn))

            if command == "baseline":
                return await _do_baseline(conn, discovered, applied, plan)

            _report(plan, discovered, applied)

            if plan.needs_baseline:
                print(_baseline_message(), file=sys.stderr)
                return 1
            if plan.drifted:
                print(
                    "適用済み migration の内容が変更されている: "
                    + ", ".join(plan.drifted)
                    + "\n適用済みファイルは書き換えず、新しい番号のファイルを追加すること。",
                    file=sys.stderr,
                )
                return 1
            if command == "status":
                return 0

            for m in plan.pending:
                await _apply(conn, m)
                print(f"適用: {m.version}")
            print("完了" if plan.pending else "適用対象なし")
            return 0
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_KEY)
    finally:
        await conn.close()


async def _do_baseline(
    conn: asyncpg.Connection,
    discovered: list[Migration],
    applied: dict[str, str],
    plan: Plan,
) -> int:
    """既存 DB の現状を「全て適用済み」として一度だけ記録する。

    誤用すると未適用の migration を握り潰すため、両側で fail-closed にする。
    """
    if applied:
        print(
            f"{MIGRATIONS_TABLE} に既に {len(applied)} 件の記録がある。baseline は"
            "初回の一度きりの操作なので実行しない。",
            file=sys.stderr,
        )
        return 1
    if not plan.needs_baseline:
        print(
            "DB にスキーマが存在しない。baseline ではなく `up` を実行すること"
            "（`up` が 0001 から順に適用する）。",
            file=sys.stderr,
        )
        return 1

    async with conn.transaction():
        await conn.executemany(
            f"INSERT INTO {MIGRATIONS_TABLE} (version, checksum) VALUES ($1, $2)",
            [(m.version, m.checksum) for m in discovered],
        )
    for m in discovered:
        print(f"baseline: {m.version} を適用済みとして記録（SQL は実行していない）")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.db.migrate",
        description="db/migrations/*.sql を版管理付きで適用する",
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="up",
        choices=("up", "status", "baseline"),
        help="up=未適用を適用 / status=確認のみ / baseline=既存 DB を適用済みとして記録",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=None,
        help="migration ディレクトリ (既定: WMCDSS_MIGRATIONS_DIR)",
    )
    args = parser.parse_args(argv)
    directory = args.dir or Path(get_settings().migrations_dir)

    try:
        return asyncio.run(_run(directory, args.command))
    except MigrationError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
