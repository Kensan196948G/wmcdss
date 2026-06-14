#!/usr/bin/env bash
# =============================================================================
# WMCDSS WebUI セットアップスクリプト
#
# 機能:
#   1. ホスト IP を自動検出 (ip route / hostname -I フォールバック)
#   2. WMCDSS_WEBUI_PORT_START (デフォルト 9080) から空きポートを検索
#   3. .env ファイルを生成/更新 (既存値は上書きしない)
#   4. systemd --user サービスをインストール・有効化
#   5. docker compose up -d で起動確認
#
# 使い方:
#   chmod +x scripts/setup-webui.sh
#   ./scripts/setup-webui.sh [--port-start N] [--dry-run]
#
# 環境変数で挙動を制御:
#   WMCDSS_WEBUI_PORT_START=9080   スキャン開始ポート (デフォルト 9080)
#   WMCDSS_WEBUI_PORT_END=9200     スキャン終了ポート (デフォルト 9200)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SYSTEMD_UNIT_SRC="${PROJECT_ROOT}/deploy/systemd/wmcdss.service"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SYSTEMD_UNIT_DST="${SYSTEMD_USER_DIR}/wmcdss.service"
ENV_FILE="${PROJECT_ROOT}/.env"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"

PORT_START="${WMCDSS_WEBUI_PORT_START:-9080}"
PORT_END="${WMCDSS_WEBUI_PORT_END:-9200}"

DRY_RUN=false
FORCE=false

# ---------------------------------------------------------------------------
# カラー出力
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${BLUE}ℹ️  ${*}${RESET}"; }
success() { echo -e "${GREEN}✅ ${*}${RESET}"; }
warn()    { echo -e "${YELLOW}⚠️  ${*}${RESET}"; }
error()   { echo -e "${RED}❌ ${*}${RESET}" >&2; }

# ---------------------------------------------------------------------------
# 引数処理
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port-start) PORT_START="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --force)      FORCE=true; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) error "不明なオプション: $1"; exit 1 ;;
  esac
done

if [[ "${DRY_RUN}" == "true" ]]; then
  warn "DRY-RUN モード: ファイルへの書き込みは行いません"
fi

echo -e "${BOLD}━━━ WMCDSS WebUI セットアップ ━━━${RESET}"

# ---------------------------------------------------------------------------
# Step 1: ホスト IP 自動検出
# ---------------------------------------------------------------------------
info "Step 1: ホスト IP を検出しています..."

detect_ip() {
  # デフォルトルートが経由するインターフェースの IP を取得
  local ip
  ip=$(ip route get 1.1.1.1 2>/dev/null | awk '/src/{for(i=1;i<=NF;i++){if($i=="src")print $(i+1)}}' | head -1)
  if [[ -n "${ip}" && "${ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${ip}"
    return 0
  fi
  # フォールバック: hostname -I の最初の非ループバックアドレス
  ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v '^::' | head -1)
  if [[ -n "${ip}" ]]; then
    echo "${ip}"
    return 0
  fi
  echo "127.0.0.1"
}

HOST_IP=$(detect_ip)
success "検出された IP: ${HOST_IP}"

# ---------------------------------------------------------------------------
# Step 2: 空きポートを検索
# ---------------------------------------------------------------------------
info "Step 2: ${PORT_START}〜${PORT_END} の範囲で空きポートを検索しています..."

find_free_port() {
  local start="$1" end="$2"
  for port in $(seq "${start}" "${end}"); do
    # ss -tlnp でリッスン中ポートを確認 (docker bind も検出)
    if ! ss -tlnp 2>/dev/null | awk '{print $4}' | grep -q ":${port}$"; then
      echo "${port}"
      return 0
    fi
  done
  return 1
}

if WEBUI_PORT=$(find_free_port "${PORT_START}" "${PORT_END}"); then
  success "空きポートが見つかりました: ${WEBUI_PORT}"
else
  error "${PORT_START}〜${PORT_END} の範囲に空きポートがありません"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: .env ファイルを生成/更新
# ---------------------------------------------------------------------------
info "Step 3: .env ファイルを更新しています... (${ENV_FILE})"

write_env_var() {
  local key="$1" value="$2"
  if [[ -f "${ENV_FILE}" ]] && grep -q "^${key}=" "${ENV_FILE}"; then
    if [[ "${FORCE}" == "true" ]]; then
      sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
      info "  ${key} を上書き: ${value}"
    else
      local existing
      existing=$(grep "^${key}=" "${ENV_FILE}" | cut -d= -f2-)
      info "  ${key} は既に設定済み (${existing}) — --force で上書き可"
    fi
  else
    echo "${key}=${value}" >> "${ENV_FILE}"
    info "  ${key}=${value} を追記"
  fi
}

if [[ "${DRY_RUN}" == "false" ]]; then
  # ファイルがなければヘッダ付きで作成
  if [[ ! -f "${ENV_FILE}" ]]; then
    cat > "${ENV_FILE}" <<EOF
# WMCDSS — 自動生成 .env (setup-webui.sh)
# このファイルは setup-webui.sh によって管理されます
# 手動編集後は --force フラグなしで再実行すると既存値が保持されます
EOF
    success ".env ファイルを新規作成しました"
  fi

  # WebUI ホスト・ポート
  write_env_var "WMCDSS_WEBUI_HOST" "${HOST_IP}"
  write_env_var "WMCDSS_WEBUI_PORT" "${WEBUI_PORT}"

  # CORS Origins (動的生成)
  CORS_ORIGINS="http://${HOST_IP}:${WEBUI_PORT},http://localhost:${WEBUI_PORT},http://127.0.0.1:${WEBUI_PORT}"
  write_env_var "WMCDSS_CORS_ORIGINS_RAW" "${CORS_ORIGINS}"
else
  echo "  [DRY-RUN] WMCDSS_WEBUI_HOST=${HOST_IP}"
  echo "  [DRY-RUN] WMCDSS_WEBUI_PORT=${WEBUI_PORT}"
fi

# ---------------------------------------------------------------------------
# Step 4: systemd --user サービスをインストール・有効化
# ---------------------------------------------------------------------------
info "Step 4: systemd ユーザーサービスをインストールしています..."

if [[ ! -f "${SYSTEMD_UNIT_SRC}" ]]; then
  error "systemd unit ファイルが見つかりません: ${SYSTEMD_UNIT_SRC}"
  exit 1
fi

if [[ "${DRY_RUN}" == "false" ]]; then
  mkdir -p "${SYSTEMD_USER_DIR}"
  cp "${SYSTEMD_UNIT_SRC}" "${SYSTEMD_UNIT_DST}"
  success "サービスファイルをコピー: ${SYSTEMD_UNIT_DST}"

  # linger 有効化 (ログアウト後もサービスを維持)
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$(whoami)" 2>/dev/null || true
    success "loginctl enable-linger を設定 (ログアウト後も自動起動)"
  fi

  # systemd デーモンリロード・有効化
  systemctl --user daemon-reload
  systemctl --user enable wmcdss.service
  success "wmcdss.service を自動起動に登録しました"
else
  echo "  [DRY-RUN] cp ${SYSTEMD_UNIT_SRC} ${SYSTEMD_UNIT_DST}"
  echo "  [DRY-RUN] systemctl --user enable wmcdss.service"
fi

# ---------------------------------------------------------------------------
# Step 5: docker compose up -d で起動
# ---------------------------------------------------------------------------
info "Step 5: docker compose を起動しています..."

if [[ "${DRY_RUN}" == "false" ]]; then
  if ! command -v docker &>/dev/null; then
    error "docker コマンドが見つかりません。Docker をインストールしてください"
    exit 1
  fi

  cd "${PROJECT_ROOT}"
  docker compose --env-file "${ENV_FILE}" pull --quiet 2>/dev/null || true
  docker compose --env-file "${ENV_FILE}" up -d --remove-orphans
  success "コンテナを起動しました"

  # ヘルスチェック待機 (最大 60 秒)
  info "サービスの起動を確認しています (最大 60 秒)..."
  for i in $(seq 1 12); do
    sleep 5
    STATUS=$(docker compose --env-file "${ENV_FILE}" ps --format json 2>/dev/null \
      | python3 -c "import sys,json; data=sys.stdin.read(); rows=[json.loads(l) for l in data.splitlines() if l]; unhealthy=[r['Name'] for r in rows if r.get('Health','') not in ('healthy','')]; print(','.join(unhealthy))" 2>/dev/null || echo "")
    if [[ -z "${STATUS}" ]]; then
      success "全コンテナが正常に起動しました"
      break
    fi
    info "  起動待機中... (${i}/12)"
  done
else
  echo "  [DRY-RUN] docker compose up -d --remove-orphans"
fi

# ---------------------------------------------------------------------------
# 完了サマリー
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}━━━ セットアップ完了 ━━━${RESET}"
echo -e "  🌐 WebUI URL : ${GREEN}http://${HOST_IP}:${WEBUI_PORT}${RESET}"
echo -e "  🔧 API  URL : ${GREEN}http://${HOST_IP}:8003${RESET}"
echo -e "  📁 .env     : ${ENV_FILE}"
echo -e "  🔁 自動起動 : systemd --user (wmcdss.service)"
echo ""
echo -e "${YELLOW}次回起動時の確認コマンド:${RESET}"
echo "  systemctl --user status wmcdss.service"
echo "  docker compose ps"
echo ""

if [[ "${DRY_RUN}" == "true" ]]; then
  warn "DRY-RUN モードのため実際の変更は行われていません"
  warn "実際に適用するには: $0 (オプションなし)"
fi
