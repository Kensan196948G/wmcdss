#!/usr/bin/env bash
#
# wmcdss-healthcheck.sh — 死活・データ鮮度・バックアップ鮮度の簡易監視
#
# cron / Uptime Kuma / Cloudflare Healthcheck 等から呼び出して使う。
# 失敗時は非ゼロ終了 + 原因メッセージを stderr へ出力する。
#
# 使い方:
#   scripts/wmcdss-healthcheck.sh                          # /readyz + バックアップ健全性
#   scripts/wmcdss-healthcheck.sh --no-backup-check        # バックアップ確認をスキップ
#   WMCDSS_HEALTH_URL=https://wmcdss.example.com/readyz \
#     scripts/wmcdss-healthcheck.sh
#
# 環境変数:
#   WMCDSS_HEALTH_URL            死活確認 URL (既定: http://127.0.0.1:9080/readyz)
#   WMCDSS_BACKUP_DIR            バックアップ探索先 (既定: <repo>/backups)
#   WMCDSS_BACKUP_MAX_AGE_HOURS  鮮度上限 (既定: 36)
#   WMCDSS_BACKUP_MIN_BYTES      最小サイズ (既定: 1024)
#
# ## なぜ mtime だけの監視をやめたか (2026-09-29 修正 / F-2)
#
# 修正前は最新バックアップの **mtime しか見ていなかった**。そのため
# pg_dump が失敗して残った「20 バイトの有効な空 gzip」でも「0h 前」と表示して
# ALL OK を返していた。鮮度が新しければ中身は問わない、という監視は
# 「バックアップがある」ことしか保証せず、「復元できる」ことを何も保証しない。
#
# 現在は最新世代について サイズ下限 → `gzip -t` → mtime の順に検証し、
# さらに全世代のサイズ下限を確認する（stat のみで安価）。
# `gzip -t` を最新世代に限るのは O(ファイルサイズ) であり、10 分間隔の
# healthcheck で 30 世代すべてを伸長すると無視できない負荷になるため。
# サイズ下限は空 gzip を弾けるので、古い世代の「空」は安価に検出できる。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_URL="${WMCDSS_HEALTH_URL:-http://127.0.0.1:9080/readyz}"
BACKUP_DIR="${WMCDSS_BACKUP_DIR:-${REPO_ROOT}/backups}"
BACKUP_MAX_AGE_HOURS="${WMCDSS_BACKUP_MAX_AGE_HOURS:-36}"
# 空 gzip は 20 バイトで `gzip -t` を通る。サイズ下限がそれを弾く唯一の関門。
BACKUP_MIN_BYTES="${WMCDSS_BACKUP_MIN_BYTES:-1024}"
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

  # 全世代の「空」を安価に検出する（stat のみ）。
  generation_count=0
  broken=0
  for f in "${BACKUP_DIR}"/wmcdss_*.sql.gz; do
    [[ -e "$f" ]] || continue
    generation_count=$((generation_count + 1))
    bytes="$(stat -c %s "$f" 2>/dev/null || echo 0)"
    if (( bytes < BACKUP_MIN_BYTES )); then
      echo "ERROR: 壊れた/空のバックアップ: $f (${bytes} bytes < 下限 ${BACKUP_MIN_BYTES})" >&2
      echo "ERROR: 空 gzip は 'gzip -t' を通過する。このファイルを削除して再取得すること。" >&2
      broken=1
    fi
  done
  if (( broken != 0 )); then
    exit 1
  fi

  # 最新世代は中身まで検証する（O(size) なので 1 ファイルに限定）。
  latest_bytes="$(stat -c %s "$latest" 2>/dev/null || echo 0)"
  if ! gzip -t "$latest" 2>/dev/null; then
    echo "ERROR: 最新バックアップの gzip 整合性チェックに失敗: $latest" >&2
    exit 1
  fi

  age_hours="$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))"
  if [[ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]]; then
    echo "ERROR: 最新バックアップが ${age_hours}h 前（上限 ${BACKUP_MAX_AGE_HOURS}h）: $latest" >&2
    exit 1
  fi

  echo "[healthcheck] 最新バックアップ ${age_hours}h 前 / ${latest_bytes} bytes / gzip OK: $latest"
  echo "[healthcheck] バックアップ世代数: ${generation_count}（全て下限 ${BACKUP_MIN_BYTES} bytes 以上）"
fi

echo "[healthcheck] ALL OK"
