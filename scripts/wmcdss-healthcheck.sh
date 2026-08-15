#!/usr/bin/env bash
#
# wmcdss-healthcheck.sh — 死活・データ鮮度・バックアップ鮮度の簡易監視
#
# cron / Uptime Kuma / Cloudflare Healthcheck 等から呼び出して使う。
# 失敗時は非ゼロ終了 + 原因メッセージを stderr へ出力する。
#
# 使い方:
#   scripts/wmcdss-healthcheck.sh                          # /readyz + バックアップ鮮度
#   scripts/wmcdss-healthcheck.sh --no-backup-check        # バックアップ確認をスキップ
#   WMCDSS_HEALTH_URL=https://wmcdss.example.com/readyz \
#     scripts/wmcdss-healthcheck.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${WMCDSS_HEALTH_URL:-http://127.0.0.1:9080/readyz}"
BACKUP_DIR="${WMCDSS_BACKUP_DIR:-${REPO_ROOT}/backups}"
BACKUP_MAX_AGE_HOURS="${WMCDSS_BACKUP_MAX_AGE_HOURS:-36}"
CHECK_BACKUP=1

for arg in "$@"; do
  case "$arg" in
    --no-backup-check) CHECK_BACKUP=0 ;;
    -h|--help)
      echo "Usage: $0 [--no-backup-check]" >&2
      exit 0
      ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

echo "[healthcheck] GET $HEALTH_URL"
if ! curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "ERROR: /readyz が 200 を返しません（$HEALTH_URL）" >&2
  exit 1
fi
echo "[healthcheck] /readyz OK"

if [[ $CHECK_BACKUP -eq 1 ]]; then
  latest="$(ls -1t "${BACKUP_DIR}"/wmcdss_*.sql.gz 2>/dev/null | head -1 || true)"
  if [[ -z "$latest" ]]; then
    echo "ERROR: バックアップが 1 件も見つかりません（${BACKUP_DIR}）" >&2
    exit 1
  fi
  age_hours="$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))"
  if [[ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]]; then
    echo "ERROR: 最新バックアップが ${age_hours}h 前（上限 ${BACKUP_MAX_AGE_HOURS}h）: $latest" >&2
    exit 1
  fi
  echo "[healthcheck] 最新バックアップ ${age_hours}h 前: $latest"
fi

echo "[healthcheck] ALL OK"
