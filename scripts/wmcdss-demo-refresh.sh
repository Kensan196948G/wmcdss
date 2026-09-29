#!/usr/bin/env bash
#
# wmcdss-demo-refresh.sh — デモ観測値のリフレッシュ（何度でも実行可能）
#
# なぜ必要か:
#   db/migrations/0004_demo_observations.sql と 0005_demo_timeseries.sql は
#   投入時刻を now() 相対で決めるが、migration は一度しか走らない。時間が経つと
#   観測値が stale 化し、判定 API の鮮度ガード（気象 30 分 / 海象 3 時間）を
#   満たす行が無くなるため、全現場・全作業種別が
#   「観測値欠測 → caution」に固定される（go も stop も出なくなる）。
#   本スクリプトは db/demo/refresh_demo_observations.sql を流し込み、
#   デモ由来の行だけを入れ替えて鮮度を回復させる。
#
# 使い方:
#   scripts/wmcdss-demo-refresh.sh                 # docker exec で稼働中 DB を更新
#   scripts/wmcdss-demo-refresh.sh --dry-run       # 実行せず対象と件数だけ表示
#   scripts/wmcdss-demo-refresh.sh --compose dev   # docker compose exec 経由（dev compose）
#   scripts/wmcdss-demo-refresh.sh --compose production
#
# 環境変数（既定値）:
#   WMCDSS_HOME         リポジトリの絶対パス（スクリプト位置から自動解決）
#   WMCDSS_DB_CONTAINER DB コンテナ名            (wmcdss-db)
#   WMCDSS_DB_USER      DB ユーザー              (wmcdss)
#   WMCDSS_DB_NAME      DB 名                    (wmcdss)
#
# 安全側の設計:
#   - 削除するのは refresh_demo_observations.sql が管理する
#     source IN ('demo','demo_series') の行だけ。DELETE のみで DROP/TRUNCATE は
#     一切使わない。実測（jma / nowphas / open_meteo_marine_info）と
#     テスト fixture（pytest）には触れない。
#   - 実行前後に行数を表示し、sites / thresholds が変化していないことを
#     オペレータが目視できるようにしている。
#   - psql は -v ON_ERROR_STOP=1 で実行し、途中失敗時は非ゼロ終了する
#     （SQL 側も BEGIN/COMMIT で囲んでいるため、失敗時はロールバックされる）。
#
# 定時実行:
#   deploy/systemd/wmcdss-demo-refresh.{service,timer} を参照。
#   手順は docs/DEMO-DATA.md。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WMCDSS_HOME="${WMCDSS_HOME:-$REPO_ROOT}"
SQL_FILE="${WMCDSS_HOME}/db/demo/refresh_demo_observations.sql"

DB_CONTAINER="${WMCDSS_DB_CONTAINER:-wmcdss-db}"
DB_USER="${WMCDSS_DB_USER:-wmcdss}"
DB_NAME="${WMCDSS_DB_NAME:-wmcdss}"

COMPOSE_TARGET=""
DRY_RUN=0

usage() {
  cat >&2 <<'EOF'
Usage: wmcdss-demo-refresh.sh [--compose production|dev] [--dry-run]

  （引数なし）      docker exec で wmcdss-db コンテナへ SQL を流し込む
  --compose TARGET  docker compose exec 経由で実行（compose plugin 必須）
  --dry-run         SQL を実行せず、対象ファイルと現在の行数だけ表示
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose)
      [[ $# -ge 2 ]] || usage
      case "$2" in
        production|dev) COMPOSE_TARGET="$2" ;;
        *) echo "unknown --compose value: $2" >&2; usage ;;
      esac
      shift 2
      ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[[ -f "$SQL_FILE" ]] || { echo "ERROR: SQL が見つかりません: $SQL_FILE" >&2; exit 1; }

# psql 実行コマンドを組み立てる。stdin から SQL を流すため -i が必要。
if [[ -n "$COMPOSE_TARGET" ]]; then
  if [[ "$COMPOSE_TARGET" == "dev" ]]; then
    COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
    ENV_FILE="${REPO_ROOT}/.env"
  else
    COMPOSE_FILE="${REPO_ROOT}/docker-compose.production.yml"
    ENV_FILE="${REPO_ROOT}/.env.production"
  fi
  [[ -f "$COMPOSE_FILE" ]] || {
    echo "ERROR: compose ファイルが見つかりません: $COMPOSE_FILE" >&2; exit 1; }
  [[ -f "$ENV_FILE" ]] || {
    echo "ERROR: env ファイルが見つかりません: $ENV_FILE" >&2
    echo "       （--compose を使わない docker exec 経路なら env ファイルは不要です）" >&2
    exit 1; }
  PSQL=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db
        psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME")
else
  command -v docker >/dev/null 2>&1 || { echo "ERROR: docker が見つかりません" >&2; exit 1; }
  if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" >/dev/null 2>&1; then
    echo "ERROR: コンテナ '$DB_CONTAINER' が見つかりません" >&2; exit 1
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" != "true" ]]; then
    echo "ERROR: コンテナ '$DB_CONTAINER' が起動していません" >&2; exit 1
  fi
  PSQL=(docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME")
fi

counts_sql() {
  cat <<'SQL'
SELECT 'weather_observations' AS tbl,
       count(*) AS total,
       count(*) FILTER (WHERE source = 'demo')        AS demo,
       count(*) FILTER (WHERE source = 'demo_series') AS demo_series,
       count(*) FILTER (WHERE source NOT IN ('demo','demo_series')) AS other,
       max(observed_at) FILTER (WHERE source = 'demo_series') AS latest_demo
  FROM weather_observations
UNION ALL
SELECT 'marine_observations',
       count(*),
       count(*) FILTER (WHERE source = 'demo'),
       count(*) FILTER (WHERE source = 'demo_series'),
       count(*) FILTER (WHERE source NOT IN ('demo','demo_series')),
       max(observed_at) FILTER (WHERE source = 'demo_series')
  FROM marine_observations
UNION ALL
SELECT 'sites', count(*), NULL, NULL, NULL, NULL FROM sites
UNION ALL
SELECT 'thresholds', count(*), NULL, NULL, NULL, NULL FROM thresholds;
SQL
}

echo "[$(date '+%Y-%m-%d %H:%M:%S')] demo refresh start (sql=${SQL_FILE})"
echo "--- before ---"
"${PSQL[@]}" -c "$(counts_sql)"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] 実行する SQL: ${SQL_FILE}"
  echo "[dry-run] 実行コマンド: ${PSQL[*]} < ${SQL_FILE}"
  echo "[dry-run] DB は変更していません"
  exit 0
fi

# SQL は BEGIN/COMMIT で囲まれているため、失敗時は psql が非ゼロ終了し
# トランザクションはロールバックされる（中途半端な状態を残さない）。
"${PSQL[@]}" < "$SQL_FILE"

echo "--- after ---"
"${PSQL[@]}" -c "$(counts_sql)"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] demo refresh done"
