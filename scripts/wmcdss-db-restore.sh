#!/usr/bin/env bash
#
# wmcdss-db-restore.sh — PostgreSQL バックアップ復元 (cron 運用者の手動操作用)
#
# 使い方:
#   scripts/wmcdss-db-restore.sh                            # 最新のバックアップを本番 DB へ復元
#   scripts/wmcdss-db-restore.sh backups/wmcdss_20260812_033000.sql.gz
#   scripts/wmcdss-db-restore.sh --compose dev backups/foo.sql.gz
#   scripts/wmcdss-db-restore.sh --db-name wmcdss_restore_check backups/foo.sql.gz
#   scripts/wmcdss-db-restore.sh --dry-run                  # 実行せずに動作だけ表示
#
# 環境変数:
#   WMCDSS_BACKUP_DIR       バックアップ探索先 (既定: <repo>/backups)
#   WMCDSS_BACKUP_MIN_BYTES 受理する最小サイズ (既定: 1024)
#
# 前提:
#   - バックアップは scripts/wmcdss-db-backup.sh が作った
#     `pg_dump --clean --if-exists` 形式 (.sql.gz) であること
#   - 復元先のコンテナスタックが起動済みであること
#   - 復元は既存データを置き換える破壊的操作。実行前にバックアップが
#     別ホスト/外部ストレージへ退避済みであることを確認すること
#
# 重要:
#   - バックアップの正本は外部ストレージ/別ホストへの退避を推奨
#     （スクリプト自体はローカル保存・ローカル復元のみ対応）
#   - 復元後に必ず smoke 確認（/readyz 200、現場一覧・判定 API）を行うこと
#
# ## なぜ「無検証の復元」をやめたか (2026-09-29 修正 / F-2)
#
# 修正前は入力の検証が `gzip -t` だけだった。しかし **空 gzip (20 バイト) は
# `gzip -t` を通過する**。その結果、pg_dump が失敗して残った空バックアップを
# 渡しても `psql` は空入力を読んで EXIT=0 を返し、スクリプトは何も復元しない
# まま「restore done」と表示していた。復元できたかどうかは障害対応の最中に
# 初めて分かる、という最悪の失敗形である。
#
# 現在は次の 3 段で「復元できた」ことを証明してから完了を宣言する。
#   1. 入力検証: 存在 / サイズ下限 / gzip 整合性（1 つでも欠ければ psql へ流さない）
#   2. 期待値の抽出: ダンプ内の COPY ブロックから「復元後に一致すべき行数」を数える
#   3. 復元後の照合: 実 DB の行数と突き合わせ、1 テーブルでも違えば非 0 終了
# 「restore done」は 3 段すべてを通過したときだけ表示する。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.production.yml"
ENV_FILE=".env.production"
COMPOSE_TARGET="production"
BACKUP_DIR="${WMCDSS_BACKUP_DIR:-${REPO_ROOT}/backups}"
DB_USER=""
DB_NAME=""
DRY_RUN=0

# サイズ下限。バックアップ側と同じ既定値を使う（片方だけ緩いと意味がない）。
MIN_BYTES="${WMCDSS_BACKUP_MIN_BYTES:-1024}"

usage() {
  echo "Usage: $0 [--compose production|dev] [--db-user X] [--db-name Y] [--dry-run] [BACKUP_FILE]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose)
      [[ $# -ge 2 ]] || usage
      case "$2" in
        production) COMPOSE_TARGET="production" ;;
        dev)        COMPOSE_TARGET="dev" ;;
        *) echo "unknown --compose value: $2" >&2; usage ;;
      esac
      shift 2
      ;;
    --db-user)
      [[ $# -ge 2 ]] || usage
      DB_USER="$2"
      shift 2
      ;;
    --db-name)
      [[ $# -ge 2 ]] || usage
      DB_NAME="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help) usage ;;
    -*) echo "unknown argument: $1" >&2; usage ;;
    *) BACKUP_FILE="$1"; shift ;;
  esac
done

if [[ "$COMPOSE_TARGET" == "dev" ]]; then
  COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
  ENV_FILE=".env"
  DB_USER="${DB_USER:-wmcdss}"
  DB_NAME="${DB_NAME:-wmcdss}"
else
  DB_USER="${DB_USER:-wmcdss_app}"
  DB_NAME="${DB_NAME:-wmcdss}"
fi

if [[ -f "${REPO_ROOT}/${ENV_FILE}" ]]; then
  env_user="$(grep -E '^POSTGRES_USER=' "${REPO_ROOT}/${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  env_name="$(grep -E '^POSTGRES_DB=' "${REPO_ROOT}/${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  [[ -z "$DB_USER" && -n "$env_user" ]] && DB_USER="$env_user"
  [[ -z "$DB_NAME" && -n "$env_name" ]] && DB_NAME="$env_name"
fi

if [[ -z "${BACKUP_FILE:-}" ]]; then
  BACKUP_FILE="$(ls -1t "${BACKUP_DIR}"/wmcdss_*.sql.gz 2>/dev/null | head -1 || true)"
fi
if [[ -z "${BACKUP_FILE:-}" ]]; then
  echo "ERROR: 復元対象のバックアップが見つかりません（${BACKUP_DIR}/wmcdss_*.sql.gz）" >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "ERROR: バックアップファイルが存在しません: $BACKUP_FILE" >&2
  exit 1
fi

COMPOSE=(docker compose --env-file "${REPO_ROOT}/${ENV_FILE}" -f "$COMPOSE_FILE")

# 対象 DB への psql。すべての読み書きをここ経由にして、接続先を 1 箇所に固定する。
psql_target() {
  "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"
}

backup_bytes="$(stat -c %s "$BACKUP_FILE" 2>/dev/null || echo 0)"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] restore start (target=${COMPOSE_TARGET}, file=${BACKUP_FILE}, ${backup_bytes} bytes, db=${DB_NAME}, user=${DB_USER})"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] would verify: size >= ${MIN_BYTES} bytes / gzip -t"
  echo "[dry-run] would run: gunzip -c ${BACKUP_FILE} | ${COMPOSE[*]} exec -T db psql -v ON_ERROR_STOP=1 -U ${DB_USER} -d ${DB_NAME}"
  echo "[dry-run] would then compare restored row counts against the COPY blocks in the dump"
  echo "[dry-run] この操作は ${DB_NAME} の既存データを置き換えます。"
  exit 0
fi

# --- 1. 入力検証 -----------------------------------------------------------
# 「存在する」だけでは足りない。空 gzip は 20 バイトで `gzip -t` を通るため、
# サイズ下限が空を弾く唯一の関門になる。1 つでも欠けたら psql へ流さない。
if (( backup_bytes < MIN_BYTES )); then
  echo "ERROR: バックアップが小さすぎる (${backup_bytes} bytes < 下限 ${MIN_BYTES} bytes): ${BACKUP_FILE}" >&2
  echo "ERROR: 空 gzip (20 bytes) は 'gzip -t' を通過する。壊れた/空のバックアップの可能性が高い。" >&2
  echo "ERROR: psql へは流していない（DB は変更されていない）。" >&2
  exit 1
fi
if ! gzip -t "$BACKUP_FILE"; then
  echo "ERROR: バックアップの gzip 整合性チェックに失敗: ${BACKUP_FILE}" >&2
  echo "ERROR: psql へは流していない（DB は変更されていない）。" >&2
  exit 1
fi

# --- 2. 期待値の抽出 -------------------------------------------------------
# pg_dump 既定の COPY 形式を前提に、復元後に一致すべき行数をダンプから数える。
# 「復元前後の比較」ではなく「ダンプ内容そのもの」を期待値にするのは、正当な
# 復元（古い時点へ戻す）では復元前後の件数が違って当然だからである。ダンプに
# 書かれていない行数を期待してしまうと、正しい復元を失敗と誤判定する。
expected_counts() {
  gzip -dc "$1" | awk '
    /^COPY / { tbl=$2; n=0; inblk=1; next }
    inblk && $0 == "\\." { printf "%s|%d\n", tbl, n; inblk=0; next }
    inblk { n++ }
  '
}

mapfile -t EXPECTED < <(expected_counts "$BACKUP_FILE")
if [[ ${#EXPECTED[@]} -eq 0 ]]; then
  echo "ERROR: ダンプから COPY ブロックを検出できなかった。行数を検証できないため中止する。" >&2
  echo "ERROR: pg_dump の --inserts 形式など COPY 形式でないダンプは本スクリプトの検証対象外。" >&2
  echo "ERROR: psql へは流していない（DB は変更されていない）。" >&2
  exit 1
fi
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 入力検証 OK: size=${backup_bytes} >= ${MIN_BYTES} / gzip -t / 期待行数 ${#EXPECTED[@]} テーブル"

# 復元先へ到達できることを先に確かめる。到達できないまま「復元した」と
# 誤認しないための事前チェック。
if ! psql_target -X -A -t -c "select 1" >/dev/null 2>&1; then
  echo "ERROR: 復元先 DB へ接続できない (db=${DB_NAME}, user=${DB_USER})。リストアを中止した。" >&2
  exit 1
fi

# --- 3. リストア -----------------------------------------------------------
# pg_dump --clean --if-exists 形式を前提とする。psql は 1 文ずつ実行し、
# エラーが 1 件でもあれば ON_ERROR_STOP=1 で即座に失敗させる（中途半端な
# 復元を「成功」と誤認しない）。
if ! gunzip -c "$BACKUP_FILE" | psql_target >/dev/null; then
  echo "ERROR: リストアに失敗した (${BACKUP_FILE} -> ${DB_NAME})。完了メッセージは出さない。" >&2
  exit 1
fi

# --- 4. 復元後の照合 -------------------------------------------------------
verify_restored_counts() {
  local sql="" pair tbl exp out failures=0 checked=0
  for pair in "${EXPECTED[@]}"; do
    tbl="${pair%%|*}"
    sql+="SELECT '${tbl}' AS tbl, count(*) AS n FROM ${tbl} UNION ALL "
  done
  sql="${sql% UNION ALL } ORDER BY tbl"

  if ! out="$(psql_target -X -A -F'|' -t -c "$sql" 2>&1)"; then
    echo "ERROR: 復元後の行数取得に失敗した（テーブル欠落の可能性）:" >&2
    echo "$out" >&2
    return 1
  fi

  while IFS='|' read -r tbl actual; do
    [[ -z "$tbl" ]] && continue
    exp=""
    for pair in "${EXPECTED[@]}"; do
      if [[ "${pair%%|*}" == "$tbl" ]]; then exp="${pair##*|}"; break; fi
    done
    checked=$((checked + 1))
    if [[ "$actual" != "$exp" ]]; then
      echo "ERROR: 復元後の行数が一致しない: ${tbl} 期待=${exp} 実際=${actual}" >&2
      failures=$((failures + 1))
    else
      echo "[restore] 件数一致: ${tbl}=${actual}"
    fi
  done <<< "$out"

  if (( checked != ${#EXPECTED[@]} )); then
    echo "ERROR: 照合できたテーブル数が期待と違う (照合=${checked} / 期待=${#EXPECTED[@]})" >&2
    return 1
  fi
  if (( failures > 0 )); then
    echo "ERROR: ${failures} テーブルで行数が不一致。復元は完了していない。" >&2
    return 1
  fi
  return 0
}

if ! verify_restored_counts; then
  echo "ERROR: 復元後の検証に失敗した。完了メッセージは出さない（DB の状態を確認すること）。" >&2
  exit 1
fi

# 完了行は「3 段の検証を通過した」ことの唯一の機械可読な印である。
# 監視が grep する文字列なので、失敗経路のメッセージには同じ語を入れないこと。
echo "[$(date '+%Y-%m-%d %H:%M:%S')] restore done (list restored: 入力検証 + 行数照合 ${#EXPECTED[@]} テーブルすべて一致)"
echo "復元後に必ず確認: 1) /readyz=200  2) 現場一覧が表示される  3) 判定 API が動く"
