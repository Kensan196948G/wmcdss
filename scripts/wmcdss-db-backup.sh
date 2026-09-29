#!/usr/bin/env bash
#
# wmcdss-db-backup.sh — PostgreSQL 定期バックアップ (cron 用)
#
# 使い方:
#   scripts/wmcdss-db-backup.sh                     # 既定 (本番 compose, 30世代)
#   scripts/wmcdss-db-backup.sh --compose dev      # 開発 compose を対象
#   scripts/wmcdss-db-backup.sh --container wmcdss-db   # compose を使わず docker exec で叩く
#                                                        # (docker run で起動したスタック用。
#                                                        #  公開 MVP スタックはこれ)
#   scripts/wmcdss-db-backup.sh --keep 14          # 保持世代数を 14 に変更
#   scripts/wmcdss-db-backup.sh --db-user X --db-name Y   # DB 資格情報を明示
#   scripts/wmcdss-db-backup.sh --remote user@host:/backup/wmcdss   # scp 退避
#   scripts/wmcdss-db-backup.sh --rclone-remote b2:wmcdss-backup    # rclone 退避
#   scripts/wmcdss-db-backup.sh --dry-run          # 実行せずに動作だけ表示
#
# 環境変数:
#   WMCDSS_BACKUP_DIR       出力先 (既定: <repo>/backups)
#   WMCDSS_BACKUP_MIN_BYTES 出力のサイズ下限 (既定: 1024)
#
# cron 例 (毎日 03:30, IT-STAFF.md 推奨に合わせた世代管理 30 日):
#   30 3 * * * /path/to/wmcdss/scripts/wmcdss-db-backup.sh >> /var/log/wmcdss-backup.log 2>&1
#
# 前提:
#   - docker compose (compose plugin) が利用可能
#   - wmcdss コンテナスタックが起動済み (db コンテナが稼働していること)
#   - バックアップの正本は外部ストレージ/別ホストへの退避を推奨 (スクリプトはローカル保存のみ)
#
# ## 出力ファイルの不変条件 (2026-09-29 修正 / F-2)
#
# **`<BACKUP_DIR>/wmcdss_*.sql.gz` という名前のファイルは「検証済み」を意味する。**
#
# 修正前は `pg_dump ... | gzip > 最終名` と直接リダイレクトしていたため、
# pg_dump が失敗しても「20 バイトの有効な空 gzip」が最終名で残っていた。
# 空 gzip は `gzip -t` を **通る**（空ストリームは正当な gzip である）ため、
# restore 側の整合性チェックも素通りし、空入力を psql に流して EXIT=0、
# つまり **何も復元していないのに「restore done」と表示される**。
# 障害時に初めて「復元できない」と判明する worst-case だった。
#
# 現在は (1) 一時ファイルへ出力 → (2) サイズ下限 → (3) gzip -t → (4) 最終名へ
# atomic rename、の順に進み、検証を通らないものは最終名にならない。
# 失敗時に既存の正常なバックアップを壊すこともない。

set -euo pipefail

# --- 既定値 ---------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.production.yml"
ENV_FILE=".env.production"
COMPOSE_TARGET="production"
# --container NAME 指定時は compose を経由せず `docker exec` で叩く（空なら compose）。
DB_CONTAINER=""
BACKUP_DIR="${WMCDSS_BACKUP_DIR:-${REPO_ROOT}/backups}"
KEEP_GENERATIONS=30
DRY_RUN=0
DB_USER=""
DB_NAME=""
REMOTE_DIR=""
RCLONE_REMOTE=""

# 出力のサイズ下限 (bytes)。空 gzip は 20 バイトで `gzip -t` を通るため、
# サイズ下限だけがそれを検出できる。1 KB は「空ではない SQL が入っている」
# ことの粗い証明として十分（実測のダンプは 24 KB 程度）。
MIN_BYTES="${WMCDSS_BACKUP_MIN_BYTES:-1024}"

# --- 引数解析 -------------------------------------------------------------
usage() {
  echo "Usage: $0 [--compose production|dev] [--container NAME] [--keep N] [--dry-run]" >&2
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
    --container)
      # `docker run` で起動したスタック（compose プロジェクトに属さない）を
      # 対象にする経路。公開 MVP スタックはまさにこれで、`docker compose exec`
      # ではコンテナを解決できず「バックアップが 1 件も取れない」状態だった
      # （2026-09-29 の DB 検証 F-1/F-6）。
      [[ $# -ge 2 ]] || usage
      DB_CONTAINER="$2"
      shift 2
      ;;
    --keep)
      [[ $# -ge 2 ]] || usage
      [[ "$2" =~ ^[0-9]+$ ]] || { echo "--keep must be a number" >&2; usage; }
      KEEP_GENERATIONS="$2"
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
    --remote)
      [[ $# -ge 2 ]] || usage
      REMOTE_DIR="$2"
      shift 2
      ;;
    --rclone-remote)
      [[ $# -ge 2 ]] || usage
      RCLONE_REMOTE="$2"
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

# --container 経路では、コンテナ自身が持つ POSTGRES_USER / POSTGRES_DB を既定に使う。
# コンテナ名だけで動くようにしておかないと、「compose の既定ユーザー (wmcdss_app) と
# 実際のロール (wmcdss) が違い、pg_dump が "role does not exist" で落ちる」という罠を
# 踏む（2026-09-29 に実際に踏んだ）。--db-user / --db-name の明示指定が最優先。
if [[ -n "$DB_CONTAINER" ]]; then
  c_env="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER" 2>/dev/null || true)"
  c_user="$(printf '%s\n' "$c_env" | sed -n 's/^POSTGRES_USER=//p' | tail -1)"
  c_name="$(printf '%s\n' "$c_env" | sed -n 's/^POSTGRES_DB=//p' | tail -1)"
  [[ -z "$DB_USER" && -n "$c_user" ]] && DB_USER="$c_user"
  [[ -z "$DB_NAME" && -n "$c_name" ]] && DB_NAME="$c_name"
fi

if [[ "$COMPOSE_TARGET" == "dev" ]]; then
  COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
  ENV_FILE=".env"
  DB_USER="${DB_USER:-wmcdss}"
  DB_NAME="${DB_NAME:-wmcdss}"
else
  DB_USER="${DB_USER:-wmcdss_app}"
  DB_NAME="${DB_NAME:-wmcdss}"
fi

# .env に明示されていればそちらを優先する（--db-user/--db-name 指定が最優先）。
if [[ -f "${REPO_ROOT}/${ENV_FILE}" ]]; then
  env_user="$(grep -E '^POSTGRES_USER=' "${REPO_ROOT}/${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  env_name="$(grep -E '^POSTGRES_DB=' "${REPO_ROOT}/${ENV_FILE}" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
  [[ -z "$DB_USER" && -n "$env_user" ]] && DB_USER="$env_user"
  [[ -z "$DB_NAME" && -n "$env_name" ]] && DB_NAME="$env_name"
fi

COMPOSE=(docker compose --env-file "${REPO_ROOT}/${ENV_FILE}" -f "$COMPOSE_FILE")

# DB への実行経路を 1 箇所に固定する。--container 指定時は compose を経由せず
# コンテナ名で直接叩く（compose プロジェクトに属さないスタック用）。
if [[ -n "$DB_CONTAINER" ]]; then
  DB_EXEC=(docker exec -i "$DB_CONTAINER")
  DB_TARGET_LABEL="docker exec ${DB_CONTAINER}"
else
  DB_EXEC=("${COMPOSE[@]}" exec -T db)
  DB_TARGET_LABEL="docker compose exec db"
fi

# --- 実行 -----------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

stamp="$(date +%Y%m%d_%H%M%S)"
out_file="${BACKUP_DIR}/wmcdss_${stamp}.sql.gz"

# 一時ファイルは最終名と **同一ディレクトリ** に作る。rename(2) が原子的なのは
# 同一ファイルシステム内に限られるため（別 FS への mv は copy+unlink になる）。
# 一時名は `wmcdss_*.sql.gz` にマッチしないので、世代管理や「最新を選ぶ」処理が
# 未検証の中間ファイルを掴むことはない。
tmp_file="${out_file}.tmp.$$"
cleanup_tmp() { rm -f "$tmp_file"; }
trap cleanup_tmp EXIT

echo "[$(date '+%Y-%m-%d %H:%M:%S')] backup start (target=${COMPOSE_TARGET}, keep=${KEEP_GENERATIONS}, min_bytes=${MIN_BYTES})"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] would run: ${DB_EXEC[*]} pg_dump --clean --if-exists -U ${DB_USER} ${DB_NAME} | gzip > ${tmp_file}"
  echo "[dry-run] then verify: size >= ${MIN_BYTES} bytes / gzip -t / mv ${tmp_file} ${out_file}"
else
  # compose exec の stdin を閉じる (-T) ことで cron 環境でもハングしない。
  # --clean --if-exists: 復元時に既存のオブジェクトを DROP してから CREATE する。
  # これを付けないと既存 DB へ復元した際に "already exists" で失敗する
  # （2026-08-09 の復元試験で実証済み）。
  #
  # 失敗を握り潰さないこと。捕まえずに進むと、落ちた pg_dump の空出力が
  # 「成功したバックアップ」に化ける（= F-2 の症状そのもの）。
  if ! "${DB_EXEC[@]}" pg_dump --clean --if-exists -U "$DB_USER" "$DB_NAME" | gzip > "$tmp_file"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: バックアップ取得に失敗した (pg_dump / ${DB_TARGET_LABEL}, db=${DB_NAME})" >&2
    echo "ERROR: 最終名のファイルは作成していない (${out_file})" >&2
    exit 1
  fi

  # 検証 (1/2): サイズ下限。空 gzip は 20 バイトで `gzip -t` を通るため、
  # ここが「空を弾く」唯一の関門になる。
  actual_bytes="$(stat -c %s "$tmp_file" 2>/dev/null || echo 0)"
  if (( actual_bytes < MIN_BYTES )); then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: バックアップが小さすぎる (${actual_bytes} bytes < 下限 ${MIN_BYTES} bytes)" >&2
    echo "ERROR: 空 gzip は 'gzip -t' を通過するため、サイズ下限が唯一の検出手段である。" >&2
    echo "ERROR: 最終名のファイルは作成していない (${out_file})" >&2
    exit 1
  fi

  # 検証 (2/2): gzip 整合性。壊れたファイルを世代管理で保持し続けると、
  # 復旧時に気付くまで何世代も無駄に残るため、作成直後に検証する。
  if ! gzip -t "$tmp_file"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: gzip 整合性チェックに失敗: ${tmp_file}" >&2
    echo "ERROR: 最終名のファイルは作成していない (${out_file})" >&2
    exit 1
  fi

  # 検証を通ったものだけを最終名へ昇格させる。
  mv -f "$tmp_file" "$out_file"
  size="$(du -h "$out_file" | cut -f1)"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] backup complete: ${out_file} (${size}, ${actual_bytes} bytes)"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 検証 OK: size=${actual_bytes} >= ${MIN_BYTES} / gzip -t"
fi

# --- 外部退避 ---------------------------------------------------------------
# ローカル保存は「サーバー障害でバックアップごと消失」するため、退避先が
# 指定された場合は作成直後の検証を通過したファイルのみを転送する。
if [[ $DRY_RUN -eq 0 && -n "$REMOTE_DIR" ]]; then
  if command -v scp >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] offsite copy (scp): $out_file -> $REMOTE_DIR"
    scp -q "$out_file" "$REMOTE_DIR" || { echo "ERROR: scp failed" >&2; exit 1; }
  else
    echo "ERROR: --remote には scp が必要です（未インストール）" >&2
    exit 1
  fi
fi

if [[ $DRY_RUN -eq 0 && -n "$RCLONE_REMOTE" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] offsite copy (rclone): $out_file -> $RCLONE_REMOTE"
    rclone copy "$out_file" "$RCLONE_REMOTE" || { echo "ERROR: rclone copy failed" >&2; exit 1; }
  else
    echo "ERROR: --rclone-remote には rclone が必要です（未インストール）" >&2
    exit 1
  fi
fi

# --- 世代管理 -------------------------------------------------------------
# 古いものから順に、保持世代数を超えたファイルを削除する。
# 一時ファイル (`*.tmp.<pid>`) はこの glob にマッチしないので対象外。
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
