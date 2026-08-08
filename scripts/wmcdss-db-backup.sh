#!/usr/bin/env bash
#
# wmcdss-db-backup.sh — PostgreSQL 定期バックアップ (cron 用)
#
# 使い方:
#   scripts/wmcdss-db-backup.sh                     # 既定 (本番 compose, 30世代)
#   scripts/wmcdss-db-backup.sh --compose dev      # 開発 compose を対象
#   scripts/wmcdss-db-backup.sh --keep 14          # 保持世代数を 14 に変更
#   scripts/wmcdss-db-backup.sh --dry-run          # 実行せずに動作だけ表示
#
# cron 例 (毎日 03:30, IT-STAFF.md 推奨に合わせた世代管理 30 日):
#   30 3 * * * /path/to/wmcdss/scripts/wmcdss-db-backup.sh >> /var/log/wmcdss-backup.log 2>&1
#
# 前提:
#   - docker compose (compose plugin) が利用可能
#   - wmcdss コンテナスタックが起動済み (db コンテナが稼働していること)
#   - バックアップの正本は外部ストレージ/別ホストへの退避を推奨 (スクリプトはローカル保存のみ)

set -euo pipefail

# --- 既定値 ---------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.production.yml"
ENV_FILE=".env.production"
COMPOSE_TARGET="production"
BACKUP_DIR="${WMCDSS_BACKUP_DIR:-${REPO_ROOT}/backups}"
KEEP_GENERATIONS=30
DRY_RUN=0

# --- 引数解析 -------------------------------------------------------------
usage() {
  echo "Usage: $0 [--compose production|dev] [--keep N] [--dry-run]" >&2
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
    --keep)
      [[ $# -ge 2 ]] || usage
      [[ "$2" =~ ^[0-9]+$ ]] || { echo "--keep must be a number" >&2; usage; }
      KEEP_GENERATIONS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

if [[ "$COMPOSE_TARGET" == "dev" ]]; then
  COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
  ENV_FILE=".env"
fi

COMPOSE=(docker compose --env-file "${REPO_ROOT}/${ENV_FILE}" -f "$COMPOSE_FILE")

# --- 実行 -----------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

stamp="$(date +%Y%m%d_%H%M%S)"
out_file="${BACKUP_DIR}/wmcdss_${stamp}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] backup start (target=${COMPOSE_TARGET}, keep=${KEEP_GENERATIONS})"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] would run: ${COMPOSE[*]} exec -T db pg_dump -U wmcdss_app wmcdss | gzip > ${out_file}"
else
  # compose exec の stdin を閉じる (-T) ことで cron 環境でもハングしない。
  "${COMPOSE[@]}" exec -T db pg_dump -U wmcdss_app wmcdss | gzip > "$out_file"
  size="$(du -h "$out_file" | cut -f1)"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] backup complete: ${out_file} (${size})"
fi

# --- 世代管理 -------------------------------------------------------------
# 古いものから順に、保持世代数を超えたファイルを削除する。
mapfile -t old_files < <(ls -1t "${BACKUP_DIR}"/wmcdss_*.sql.gz 2>/dev/null | tail -n +$((KEEP_GENERATIONS + 1)))
if [[ ${#old_files[@]} -gt 0 ]]; then
  for f in "${old_files[@]}"; do
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "[dry-run] would remove: $f"
    else
      rm -f "$f"
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] pruned: $f"
    fi
  done
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] no files to prune (<= ${KEEP_GENERATIONS} generations)"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] backup done"
