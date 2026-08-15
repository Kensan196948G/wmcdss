#!/usr/bin/env bash
#
# wmcdss-db-restore.sh — PostgreSQL バックアップ復元 (cron 運用者の手動操作用)
#
# 使い方:
#   scripts/wmcdss-db-restore.sh                            # 最新のバックアップを本番 DB へ復元
#   scripts/wmcdss-db-restore.sh backups/wmcdss_20260812_033000.sql.gz
#   scripts/wmcdss-db-restore.sh --compose dev backups/foo.sql.gz
#   scripts/wmcdss-db-restore.sh --dry-run                  # 実行せずに動作だけ表示
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

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.production.yml"
ENV_FILE=".env.production"
COMPOSE_TARGET="production"
BACKUP_DIR="${WMCDSS_BACKUP_DIR:-${REPO_ROOT}/backups}"
DB_USER=""
DB_NAME=""
DRY_RUN=0

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

echo "[$(date '+%Y-%m-%d %H:%M:%S')] restore start (target=${COMPOSE_TARGET}, file=${BACKUP_FILE}, db=${DB_NAME}, user=${DB_USER})"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] would run: gunzip -c ${BACKUP_FILE} | ${COMPOSE[*]} exec -T db psql -v ON_ERROR_STOP=1 -U ${DB_USER} -d ${DB_NAME}"
  echo "[dry-run] この操作は ${DB_NAME} の既存データを置き換えます。"
  exit 0
fi

if ! gzip -t "$BACKUP_FILE"; then
  echo "ERROR: バックアップの gzip 整合性チェックに失敗: $BACKUP_FILE" >&2
  exit 1
fi

# pg_dump --clean --if-exists 形式を前提とする。psql は 1 文ずつ実行し、
# エラーが 1 件でもあれば ON_ERROR_STOP=1 で即座に失敗させる（中途半端な
# 復元を「成功」と誤認しない）。
gunzip -c "$BACKUP_FILE" | "${COMPOSE[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] restore done"
echo "復元後に必ず確認: 1) /readyz=200  2) 現場一覧が表示される  3) 判定 API が動く"
