#!/usr/bin/env bash
#
# test-backup-restore-safety.sh — バックアップ/復元/監視の「無言の失敗」回帰テスト
#
# 目的 (F-2 / 2026-09-29 の DB 検証で実測した worst-case を二度と作らない)
# ---------------------------------------------------------------------------
# 修正前の実装は次の 3 ケースを「成功」として扱っていた。
#
#   1. 空 gzip          : `gzip -t` を通る。restore は空入力を psql に流して EXIT=0、
#                        "restore done" と表示しつつ何も復元しない。
#   2. サイズ不足の gzip : 同上（サイズの検証が無い）。
#   3. 壊れた gzip       : healthcheck は mtime しか見ないため ALL OK を返す
#                        （restore 側は元から `gzip -t` で拒否していた）。
#
# さらに backup が失敗した場合、`gzip > 最終名` のリダイレクトにより
# 「20 バイトの有効な空 gzip」が最終名で残っていた（= 1 の入力を作る犯人）。
#
# このスクリプトは
#   A. 修正前 (scripts/tests/fixtures/pre-fix/) が本当に危険側だったことを実行で示し
#   B. 修正後が必ず非 0 exit / ERROR で検出することを検証する
#
# 安全性
# ---------------------------------------------------------------------------
# - 実 DB (`wmcdss`) へは **読み取り (pg_dump) しか行わない**。
# - 復元は必ずスクラッチ DB に対して行う。名前は `*_backup_check*` を必須とし、
#   スクリプト冒頭で検証して一致しなければ即座に中止する。
# - 検証後はスクラッチ DB と一時ディレクトリを必ず削除する。
# - secret は出力しない。DB 資格情報は compose 既定値相当を受け取るだけ。
#
# 使い方
# ---------------------------------------------------------------------------
#   bash scripts/tests/test-backup-restore-safety.sh
#
# 環境変数 (通常は変更不要):
#   WMCDSS_TEST_DB_CONTAINER  対象コンテナ (既定: wmcdss-db)
#   WMCDSS_TEST_DB_USER       DB ユーザー   (既定: wmcdss)
#   WMCDSS_TEST_DB_NAME       dump 元 DB    (既定: wmcdss)
#   WMCDSS_TEST_SCRATCH_DB    復元先       (既定: wmcdss_backup_check)
#   WMCDSS_TEST_HEALTH_URL    /readyz URL  (既定: http://127.0.0.1:18003/readyz)
#   WMCDSS_TEST_SKIP_DB=1     DB を使う検証を SKIP する（DB が無い環境用）

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_SCRIPT="${REPO_ROOT}/scripts/wmcdss-db-backup.sh"
RESTORE_SCRIPT="${REPO_ROOT}/scripts/wmcdss-db-restore.sh"
HEALTHCHECK_SCRIPT="${REPO_ROOT}/scripts/wmcdss-healthcheck.sh"
PREFIX_DIR="${REPO_ROOT}/scripts/tests/fixtures/pre-fix"
PREFIX_BACKUP="${PREFIX_DIR}/wmcdss-db-backup.sh"
PREFIX_RESTORE="${PREFIX_DIR}/wmcdss-db-restore.sh"
PREFIX_HEALTHCHECK="${PREFIX_DIR}/wmcdss-healthcheck.sh"

DB_CONTAINER="${WMCDSS_TEST_DB_CONTAINER:-wmcdss-db}"
DB_USER="${WMCDSS_TEST_DB_USER:-wmcdss}"
DB_NAME="${WMCDSS_TEST_DB_NAME:-wmcdss}"
SCRATCH_DB="${WMCDSS_TEST_SCRATCH_DB:-wmcdss_backup_check}"
SKIP_DB="${WMCDSS_TEST_SKIP_DB:-0}"

PASS=0
FAIL=0
SKIP=0
FAILED_NAMES=()

pass() { PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); FAILED_NAMES+=("$1"); printf '  [FAIL] %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  [SKIP] %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

# --- 安全ガード: 復元先はスクラッチ DB のみ ---------------------------------
case "$SCRATCH_DB" in
  *_backup_check*) : ;;
  *)
    echo "FATAL: 復元先 DB 名に '_backup_check' を含めてください: '${SCRATCH_DB}'" >&2
    echo "FATAL: 実 DB を壊さないためのガードです。中断します。" >&2
    exit 2
    ;;
esac
if [[ "$SCRATCH_DB" == "$DB_NAME" ]]; then
  echo "FATAL: 復元先が dump 元 DB と同じです ('${SCRATCH_DB}')。中断します。" >&2
  exit 2
fi

# --- 一時領域 ---------------------------------------------------------------
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wmcdss-backup-safety.XXXXXX")"
SHIM_DIR="${TMP_DIR}/bin"
BK_GOOD="${TMP_DIR}/backups-good"
BK_OLD="${TMP_DIR}/backups-old"
BK_CORRUPT="${TMP_DIR}/backups-corrupt"
BK_TINY="${TMP_DIR}/backups-tiny"
BK_EMPTY="${TMP_DIR}/backups-empty"
BK_NOPRUNE="${TMP_DIR}/backups-noprune"
mkdir -p "$SHIM_DIR" "$BK_GOOD" "$BK_OLD" "$BK_CORRUPT" "$BK_TINY" "$BK_EMPTY" "$BK_NOPRUNE"

EMPTY_GZ="${TMP_DIR}/empty.sql.gz"
TINY_GZ="${TMP_DIR}/tiny.sql.gz"
CORRUPT_GZ="${TMP_DIR}/corrupt.sql.gz"
OUT="${TMP_DIR}/out.txt"

# --- docker compose シム -----------------------------------------------------
# 本リポジトリのスクリプトは `docker compose --env-file ... -f ... exec -T db <cmd>`
# で DB へ到達する。compose プロジェクトが無い環境でも **スクリプト本体のロジック**
# を検証できるよう、compose の exec を `docker exec -i <container>` へ等価変換する
# シムを PATH の先頭に置く。pg_dump / psql は本物が動く。
REAL_DOCKER="$(command -v docker || true)"
if [[ -z "$REAL_DOCKER" ]]; then
  echo "FATAL: docker が見つかりません。このテストは稼働中の DB コンテナが必要です。" >&2
  rm -rf "$TMP_DIR"
  exit 2
fi
cat > "${SHIM_DIR}/docker" <<SHIM
#!/usr/bin/env bash
set -uo pipefail
if [[ "\${1:-}" == "compose" ]]; then
  shift
  while [[ \$# -gt 0 && "\${1:-}" == -* ]]; do
    case "\$1" in
      --env-file|-f|--file|-p|--project-name) shift 2 ;;
      *) shift ;;
    esac
  done
  sub="\${1:-}"; shift || true
  if [[ "\$sub" != "exec" ]]; then
    echo "[docker-shim] unsupported compose subcommand: \$sub" >&2
    exit 2
  fi
  while [[ \$# -gt 0 && "\${1:-}" == -* ]]; do
    case "\$1" in
      -e|--env) shift 2 ;;
      *) shift ;;
    esac
  done
  shift || true   # service name
  exec "${REAL_DOCKER}" exec -i "\${WMCDSS_TEST_DB_CONTAINER:-${DB_CONTAINER}}" "\$@"
fi
exec "${REAL_DOCKER}" "\$@"
SHIM
chmod +x "${SHIM_DIR}/docker"
export PATH="${SHIM_DIR}:${PATH}"

# --- 検証用ファイル ---------------------------------------------------------
printf '' | gzip > "$EMPTY_GZ"                                   # 空 gzip (20 bytes)
printf 'SELECT 1;\n' | gzip > "$TINY_GZ"                         # 有効だがサイズ不足
head -c 8192 /dev/urandom | gzip > "$CORRUPT_GZ"                 # 十分なサイズの gzip
printf 'NOT-A-GZIP-FILE!' | dd of="$CORRUPT_GZ" bs=1 conv=notrunc status=none
EMPTY_BYTES="$(stat -c %s "$EMPTY_GZ")"
TINY_BYTES="$(stat -c %s "$TINY_GZ")"
CORRUPT_BYTES="$(stat -c %s "$CORRUPT_GZ")"

# 検証に使うダンプを嵩増しするための、圧縮されにくいコメント行。
# (繰り返し文字だと gzip が数十バイトまで縮み、サイズ下限の検証を素通りしてしまう)
pad_comment() { printf -- '--%s\n' "$(head -c 2048 /dev/urandom | base64 | tr -d '\n')"; }

# --- 実行ヘルパ -------------------------------------------------------------
last_code=0
run() { # run <cmd...>
  "$@" >"$OUT" 2>&1
  last_code=$?
  return 0
}
show_out() { sed 's/^/      | /' "$OUT" | head -20; }
expect_code() { # expect_code <expected> <desc>
  if [[ "$last_code" == "$1" ]]; then
    pass "$2 (exit=$last_code)"
  else
    fail "$2 (期待 exit=$1, 実際 exit=$last_code)"
    show_out
  fi
}
expect_nonzero() { # expect_nonzero <desc>
  if [[ "$last_code" != "0" ]]; then
    pass "$1 (exit=$last_code)"
  else
    fail "$1 (期待 非0, 実際 exit=0)"
    show_out
  fi
}
expect_contains() { # expect_contains <needle> <desc>
  if grep -qF -- "$1" "$OUT"; then
    pass "$2"
  else
    fail "$2 (出力に '$1' が無い)"
    show_out
  fi
}
expect_not_contains() { # expect_not_contains <needle> <desc>
  if grep -qF -- "$1" "$OUT"; then
    fail "$2 (禁止文字列 '$1' が出力された)"
    show_out
  else
    pass "$2"
  fi
}
count_backup_files() { ls -1 "${1}"/wmcdss_*.sql.gz 2>/dev/null | wc -l; }
count_tmp_files() { ls -1 "${1}"/wmcdss_*.tmp.* 2>/dev/null | wc -l; }

restore_scratch() { # restore_scratch <backup_file> [script]
  local file="$1" script="${2:-$RESTORE_SCRIPT}"
  run bash "$script" --compose production --db-user "$DB_USER" --db-name "$SCRATCH_DB" "$file"
}
run_backup() { # run_backup <backup_dir> <container> [script]
  local dir="$1" container="$2" script="${3:-$BACKUP_SCRIPT}"
  run env WMCDSS_TEST_DB_CONTAINER="$container" WMCDSS_BACKUP_DIR="$dir" \
      bash "$script" --compose production --db-user "$DB_USER" --db-name "$DB_NAME"
}
run_healthcheck() { # run_healthcheck <backup_dir> [script]
  local dir="$1" script="${2:-$HEALTHCHECK_SCRIPT}"
  run env WMCDSS_HEALTH_URL="$HEALTH_URL" WMCDSS_BACKUP_DIR="$dir" bash "$script"
}

# --- 後始末 -----------------------------------------------------------------
cleanup() {
  local rc=$?
  "$REAL_DOCKER" exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
  printf '\n後始末: スクラッチ DB (%s) と一時ディレクトリ (%s) を削除した。\n' "$SCRATCH_DB" "$TMP_DIR"
  return $rc
}
trap cleanup EXIT

# --- /readyz の代替 (バックエンドが無い環境でも healthcheck のロジックを検証する) --
HEALTH_URL="${WMCDSS_TEST_HEALTH_URL:-http://127.0.0.1:18003/readyz}"
if ! curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
  printf '{"status":"ready"}\n' > "${TMP_DIR}/readyz.json"
  HEALTH_URL="file://${TMP_DIR}/readyz.json"
  printf '[info] /readyz に到達できないため file:// で代替する: %s\n' "$HEALTH_URL"
fi

# ===========================================================================
printf 'WMCDSS backup/restore safety test\n'
printf '  repo      : %s\n' "$REPO_ROOT"
printf '  container : %s (user=%s, dump元=%s, 復元先=%s)\n' "$DB_CONTAINER" "$DB_USER" "$DB_NAME" "$SCRATCH_DB"
printf '  fixtures  : %s\n' "$PREFIX_DIR"
printf '  検証入力  : empty=%sB / tiny=%sB / corrupt=%sB (サイズ下限=1024B)\n' \
       "$EMPTY_BYTES" "$TINY_BYTES" "$CORRUPT_BYTES"
printf '  health    : %s\n' "$HEALTH_URL"

if [[ "$SKIP_DB" == "1" ]]; then
  skip "DB を使う検証 (WMCDSS_TEST_SKIP_DB=1)"
elif ! "$REAL_DOCKER" inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  echo "FATAL: コンテナ '$DB_CONTAINER' が稼働していません。DB 無しで検証する場合は WMCDSS_TEST_SKIP_DB=1。" >&2
  exit 2
fi

section "0. テスト前提の確認（この前提が崩れると以降の検証は意味を持たない）"
if [[ "$EMPTY_BYTES" -lt 64 ]] && gzip -t "$EMPTY_GZ" 2>/dev/null && [[ "$(gzip -dc "$EMPTY_GZ" | wc -c)" == "0" ]]; then
  pass "空 gzip は ${EMPTY_BYTES} バイトで 'gzip -t' を通る（= サイズ下限が唯一の検出手段）"
else
  fail "空 gzip の前提が成立していない"
fi
if ! gzip -t "$CORRUPT_GZ" 2>/dev/null; then
  pass "壊れた gzip は 'gzip -t' で検出できる（${CORRUPT_BYTES} バイト）"
else
  fail "壊れた gzip が 'gzip -t' を通ってしまう（テスト入力が不正）"
fi

# ===========================================================================
section "A. 修正前 (pre-fix fixture) は本当に危険側だったか — 修正の必要性の証明"

if [[ ! -f "$PREFIX_RESTORE" || ! -f "$PREFIX_BACKUP" || ! -f "$PREFIX_HEALTHCHECK" ]]; then
  fail "pre-fix フィクスチャが見つからない: $PREFIX_DIR"
else
  # --- A-1: backup 失敗時に「20 バイトの有効な空 gzip」が最終名で残る --------
  run_backup "$BK_OLD" "${DB_CONTAINER}-nonexistent" "$PREFIX_BACKUP"
  expect_nonzero "A-1a 修正前 backup は失敗自体は非0で返す"
  if [[ "$(count_backup_files "$BK_OLD")" -ge 1 ]]; then
    pass "A-1b 修正前 backup は失敗したのに最終名のファイルを残す ($(count_backup_files "$BK_OLD") 件)"
  else
    fail "A-1b 修正前 backup が最終名のファイルを残していない（前提が崩れている）"
  fi
  leftover="$(ls -1 "${BK_OLD}"/wmcdss_*.sql.gz 2>/dev/null | head -1)"
  if [[ -n "$leftover" ]]; then
    lb="$(stat -c %s "$leftover")"
    if [[ "$lb" -lt 64 ]] && gzip -t "$leftover" 2>/dev/null && [[ "$(gzip -dc "$leftover" | wc -c)" == "0" ]]; then
      pass "A-1c 残ったのは ${lb} バイトの『有効な空 gzip』(gzip -t PASS / 展開 0 バイト) ← F-2 の根本原因"
    else
      fail "A-1c 残ったファイルの性質が想定と違う (${lb} bytes)"
    fi
    cp -f "$leftover" "$EMPTY_GZ"   # 以降は「実際に生まれた空 gzip」を使う
    EMPTY_BYTES="$(stat -c %s "$EMPTY_GZ")"
  fi

  if [[ "$SKIP_DB" == "1" ]]; then
    skip "A-2〜A-4 (WMCDSS_TEST_SKIP_DB=1)"
    skip "A-5a/A-5b (WMCDSS_TEST_SKIP_DB=1)"
  else
    # スクラッチ DB を用意（A-2/A-3 はここへ「復元」する）
    "$REAL_DOCKER" exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
    run "$REAL_DOCKER" exec "$DB_CONTAINER" createdb -U "$DB_USER" "$SCRATCH_DB"
    expect_code 0 "A-2a スクラッチ DB を作成した ($SCRATCH_DB)"

    # --- A-2: 空 gzip を restore に渡すと EXIT=0 で「restore done」 ---------
    restore_scratch "$EMPTY_GZ" "$PREFIX_RESTORE"
    expect_code 0 "A-2b 修正前 restore は空 gzip (${EMPTY_BYTES}B) を EXIT=0 で受理する（無言の成功）"
    expect_contains "restore done" "A-2c 修正前 restore は何も復元していないのに 'restore done' と表示する"

    # --- A-3: サイズ不足の有効 gzip も EXIT=0 ------------------------------
    restore_scratch "$TINY_GZ" "$PREFIX_RESTORE"
    expect_code 0 "A-3a 修正前 restore はサイズ不足 (${TINY_BYTES}B) のバックアップを EXIT=0 で受理する"
    expect_contains "restore done" "A-3b 修正前 restore は 'restore done' と表示する"

    # --- A-4: 壊れた gzip は restore 側では元から拒否されていた（正直な記録） --
    restore_scratch "$CORRUPT_GZ" "$PREFIX_RESTORE"
    expect_nonzero "A-4 修正前 restore も壊れた gzip は拒否していた（この経路だけは元から安全）"
  fi

  # --- A-5: healthcheck は mtime しか見ないので空/壊れでも ALL OK ----------
  cp -f "$EMPTY_GZ" "${BK_EMPTY}/wmcdss_20260101_000000.sql.gz"
  run_healthcheck "$BK_EMPTY" "$PREFIX_HEALTHCHECK"
  expect_code 0 "A-5a 修正前 healthcheck は空 gzip でも ALL OK (exit=0)"
  expect_contains "ALL OK" "A-5b 修正前 healthcheck は空 gzip を健全と報告する"

  cp -f "$CORRUPT_GZ" "${BK_CORRUPT}/wmcdss_20260101_000000.sql.gz"
  run_healthcheck "$BK_CORRUPT" "$PREFIX_HEALTHCHECK"
  expect_code 0 "A-5c 修正前 healthcheck は壊れた gzip でも ALL OK (exit=0)"
fi

# ===========================================================================
section "B. 修正後は必ず非0 exit / ERROR で検出するか"

if [[ "$SKIP_DB" == "1" ]]; then
  skip "B (WMCDSS_TEST_SKIP_DB=1)"
else
  # --- B-0: 正常なバックアップが取れる（正常系の基準を作る） ---------------
  run_backup "$BK_GOOD" "$DB_CONTAINER"
  expect_code 0 "B-0a 正常なバックアップが取得できる（pg_dump 経路の疎通）"
  expect_contains "検証 OK" "B-0b backup は検証通過を明示する"
  GOOD_DUMP="$(ls -1t "${BK_GOOD}"/wmcdss_*.sql.gz 2>/dev/null | head -1 || true)"
  if [[ -n "$GOOD_DUMP" ]] && [[ "$(stat -c %s "$GOOD_DUMP")" -ge 1024 ]]; then
    pass "B-0c 正常バックアップはサイズ下限を満たす ($(stat -c %s "$GOOD_DUMP") bytes)"
  else
    fail "B-0c 正常バックアップが期待どおり作成されていない"
  fi
  if [[ "$(count_tmp_files "$BK_GOOD")" == "0" ]]; then
    pass "B-0d 一時ファイルが残っていない（atomic rename 済み）"
  else
    fail "B-0d 一時ファイルが残っている ($(count_tmp_files "$BK_GOOD") 件)"
  fi

  # --- B-1: backup 失敗時は最終名を作らない ------------------------------
  run_backup "$BK_NOPRUNE" "${DB_CONTAINER}-nonexistent"
  expect_nonzero "B-1a 修正後 backup は失敗を非0で返す"
  if [[ "$(count_backup_files "$BK_NOPRUNE")" == "0" ]]; then
    pass "B-1b 修正後 backup は失敗時に最終名のファイルを残さない（= 空 gzip が生まれない）"
  else
    fail "B-1b 修正後 backup が失敗時に最終名のファイルを残した"
  fi
  if [[ "$(count_tmp_files "$BK_NOPRUNE")" == "0" ]]; then
    pass "B-1c 修正後 backup は一時ファイルも残さない"
  else
    fail "B-1c 修正後 backup が一時ファイルを残した"
  fi
  expect_contains "ERROR" "B-1d 修正後 backup は ERROR を出す"

  # --- B-2: 空 gzip を restore に渡すと非0 -------------------------------
  restore_scratch "$EMPTY_GZ"
  expect_nonzero "B-2a 空 gzip (${EMPTY_BYTES}B) の restore は非0で中止する"
  expect_contains "ERROR" "B-2b 空 gzip の restore は ERROR を出す"
  expect_not_contains "restore done" "B-2c 空 gzip の restore は 'restore done' を出さない"

  # --- B-3: 壊れた gzip を restore に渡すと非0 ---------------------------
  restore_scratch "$CORRUPT_GZ"
  expect_nonzero "B-3a 壊れた gzip (${CORRUPT_BYTES}B) の restore は非0で中止する"
  expect_contains "ERROR" "B-3b 壊れた gzip の restore は ERROR を出す"
  expect_not_contains "restore done" "B-3c 壊れた gzip の restore は 'restore done' を出さない"

  # --- B-4: サイズ下限未満を restore に渡すと非0 -------------------------
  restore_scratch "$TINY_GZ"
  expect_nonzero "B-4a サイズ不足 (${TINY_BYTES}B < 1024B) の restore は非0で中止する"
  expect_contains "小さすぎる" "B-4b サイズ不足である理由が明示される"
  expect_not_contains "restore done" "B-4c サイズ不足の restore は 'restore done' を出さない"

  # --- B-5: healthcheck が壊れた/空/サイズ不足を NG にする ----------------
  run_healthcheck "$BK_EMPTY"
  expect_nonzero "B-5a healthcheck は空 gzip を NG にする（mtime だけの監視を廃止した）"
  expect_contains "ERROR" "B-5b 空 gzip の healthcheck は ERROR を出す"

  run_healthcheck "$BK_CORRUPT"
  expect_nonzero "B-5c healthcheck は壊れた gzip を NG にする"

  cp -f "$TINY_GZ" "${BK_TINY}/wmcdss_20260101_000000.sql.gz"
  run_healthcheck "$BK_TINY"
  expect_nonzero "B-5d healthcheck はサイズ下限未満を NG にする"

  run_healthcheck "$BK_GOOD"
  expect_code 0 "B-5e healthcheck は健全なバックアップを ALL OK とする（過検出しない）"

  # --- B-6: 正常なバックアップ → スクラッチ DB へ restore → 件数一致 ------
  "$REAL_DOCKER" exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
  run "$REAL_DOCKER" exec "$DB_CONTAINER" createdb -U "$DB_USER" "$SCRATCH_DB"
  expect_code 0 "B-6a スクラッチ DB を再作成した"

  restore_scratch "$GOOD_DUMP"
  expect_code 0 "B-6b 正常なバックアップの restore は exit=0"
  expect_contains "restore done" "B-6c 正常な restore は 'restore done' を出す"
  expect_contains "件数一致" "B-6d 正常な restore は行数照合の結果を報告する"
  expect_not_contains "ERROR" "B-6e 正常な restore は ERROR を出さない"

  # dump 元 (実 DB) が書き換わっていないこと
  run "$REAL_DOCKER" exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -A -t -c "select count(*) from sites"
  if [[ "$(tr -d '[:space:]' < "$OUT")" == "6" ]]; then
    pass "B-6f dump 元 DB (${DB_NAME}) の sites 行数は 6 のまま（読み取りのみ・無変更）"
  else
    fail "B-6f dump 元 DB の sites 行数が変わっている: $(tr -d '[:space:]' < "$OUT")"
  fi

  # --- B-7: 宣言行数と実際の復元行数が食い違えば非0（照合ロジックの故障注入） --
  # pg_dump は同じテーブルの COPY ブロックを 2 回出さないが、2 回出したダンプを
  # 与えると「宣言 1 行」に対し「実際 2 行」となり、行数照合が必ず食い違う。
  # 照合が本当に効いているかを確認するための故障注入である。
  INJECT_SQL="${TMP_DIR}/inject.sql"
  {
    echo "DROP TABLE IF EXISTS public.zz_backup_check_probe;"
    echo "CREATE TABLE public.zz_backup_check_probe (id int);"
    echo "COPY public.zz_backup_check_probe (id) FROM stdin;"
    echo "1"
    echo "\\."
    echo "COPY public.zz_backup_check_probe (id) FROM stdin;"
    echo "2"
    echo "\\."
    pad_comment
  } > "$INJECT_SQL"
  gzip -c "$INJECT_SQL" > "${INJECT_SQL}.gz"
  restore_scratch "${INJECT_SQL}.gz"
  expect_nonzero "B-7a 宣言行数と実際の復元行数が食い違えば非0で失敗する"
  expect_contains "行数が一致しない" "B-7b 不一致がテーブル単位で明示される"
  expect_not_contains "restore done" "B-7c 不一致時は 'restore done' を出さない"

  # --- B-8: COPY ブロックが無い（検証不能な）ダンプは fail-closed ----------
  NOTCOPY_SQL="${TMP_DIR}/notcopy.sql"
  { echo "SELECT 1;"; pad_comment; } > "$NOTCOPY_SQL"
  gzip -c "$NOTCOPY_SQL" > "${NOTCOPY_SQL}.gz"
  restore_scratch "${NOTCOPY_SQL}.gz"
  expect_nonzero "B-8a 行数を検証できないダンプ (COPY 無し) は fail-closed で中止する"
  expect_contains "COPY ブロック" "B-8b 検証不能である理由が明示される"
  expect_not_contains "restore done" "B-8c 検証不能なダンプは 'restore done' を出さない"
fi

# ===========================================================================
printf '\n== 結果 ==\n'
printf '  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
if [[ "$FAIL" -gt 0 ]]; then
  printf '  失敗した項目:\n'
  for n in "${FAILED_NAMES[@]}"; do printf '    - %s\n' "$n"; done
  exit 1
fi
printf '  すべての検証項目が pass した。\n'
exit 0
