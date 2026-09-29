# WMCDSS — systemd units

## 🚀 WebUI + API 起動サービス

`wmcdss.service` — 本番用 Docker Compose 全体（WebUI + API + DB）を OS 起動時に自動起動します。

### 事前に 1 回だけ: チェックアウト位置を登録する

すべての unit は `~/.config/wmcdss/deploy.env` の **`WMCDSS_HOME` だけ**を見て
リポジトリの場所を決めます。unit ファイル側にパスは一切書かれていません。

```bash
mkdir -p ~/.config/wmcdss
cp deploy/systemd/deploy.env.example ~/.config/wmcdss/deploy.env
# WMCDSS_HOME を自分のチェックアウトの絶対パスへ書き換える
${EDITOR:-nano} ~/.config/wmcdss/deploy.env
```

このファイルは必須です。未作成のまま起動すると systemd が
`Failed to load environment files` で停止します（黙って空パスへ展開して
分かりにくく失敗するより、明示的に止める方を選んでいます）。

> **なぜ分離したか** — 本リポジトリは過去に
> `Weather-Marine-Construction-Decision-Support-System` から
> `Mirai-DX-Project/wmcdss` へ移動しており、その際 unit 3 ファイルと本 README の
> 計 9 箇所が旧パスを指したまま残り、`wmcdss.service` は起動不能になっていました。
> 参照を 1 箇所へ集約して再発を止めます。
> **secret は入れないこと。** ここはパスだけ、本番 secret は `.env.production` 側です。

### インストール

```bash
mkdir -p ~/.config/systemd/user
cp wmcdss.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss.service
sudo loginctl enable-linger $USER   # ログインなしで常時起動
```

**アクセス URL**（IP は `ip addr show` で確認）:

- WebUI: `http://<LAN-IP>:9080`
- API: WebUI の nginx 経由で `/api/v1` に公開します。API コンテナの 8000 番はホストへ直接公開しません。

---

## 📊 JMA 気象データ取得タイマー

User-level units that drive the periodic JMA observation ingest. They wrap a
`docker compose exec backend python -m app.jobs.<job>` invocation, so the job
runs inside the same Python environment and DB connection pool as the API.

Two ingesters are installed side-by-side:

| Unit                      | Job module                   | Cadence      | Upstream         |
| ------------------------- | ---------------------------- | ------------ | ---------------- |
| `wmcdss-jma-fetch`        | `app.jobs.ingest_jma`        | every 10 min | AMeDAS (land)    |
| `wmcdss-jma-fetch-marine` | `app.jobs.ingest_jma_marine` | hourly       | JMA wave nowcast |

2026-08-12 追加: JMA 波浪ナウキャストの提供方式変更に伴い、公的データ
NOWPHAS（国土交通省）取り込みタイマーを追加した。

| Unit                      | Job module                   | Cadence      | Upstream         |
| ------------------------- | ---------------------------- | ------------ | ---------------- |
| `wmcdss-nowphas-fetch`    | `app.jobs.ingest_nowphas`    | every 10 min | NOWPHAS (MLIT)   |
| `wmcdss-notify-digest`    | `app.jobs.notify_digest`     | daily 07:30  | 内部判定ダイジェスト |
| `wmcdss-db-backup`        | `scripts/wmcdss-db-backup.sh` | daily 03:30 | PostgreSQL (pg_dump) |
| `wmcdss-demo-refresh`     | `scripts/wmcdss-demo-refresh.sh` | every 10 min | デモ観測値の再投入（DB） |

2026-09-29 追加: `wmcdss-demo-refresh`。実測データが無い MVP 公開デモでは
`db/migrations/0004`/`0005` が `now()` 相対で観測値を入れるが、**migration は
一度しか走らない**ため時間経過で必ず stale 化し、判定が
「観測値欠測 → 全現場 caution」に固定される（go も stop も出ない）。
これを 10 分間隔で再投入して鮮度ガード（気象 30 分 / 海象 3 時間）を
満たし続ける。詳細は `docs/DEMO-DATA.md`。

The split mirrors the upstream contract — AMeDAS is per-station 10-min cadence,
wave is gridded hourly. Diverging the timers (instead of one combined job)
keeps each ingester's failure mode independent in `audit_log`.

## Install (user mode — no root needed)

先に上記「事前に 1 回だけ: チェックアウト位置を登録する」を済ませてください。
タイマー配下の 2 つの ingester も同じ `~/.config/wmcdss/deploy.env` を読みます。

```bash
mkdir -p ~/.config/systemd/user
cp wmcdss-jma-fetch.service        wmcdss-jma-fetch.timer        ~/.config/systemd/user/
cp wmcdss-jma-fetch-marine.service wmcdss-jma-fetch-marine.timer ~/.config/systemd/user/
cp wmcdss-nowphas-fetch.service    wmcdss-nowphas-fetch.timer    ~/.config/systemd/user/
cp wmcdss-notify-digest.service    wmcdss-notify-digest.timer    ~/.config/systemd/user/
cp wmcdss-db-backup.service        wmcdss-db-backup.timer        ~/.config/systemd/user/
cp wmcdss-demo-refresh.service     wmcdss-demo-refresh.timer     ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
systemctl --user enable --now wmcdss-jma-fetch-marine.timer
systemctl --user enable --now wmcdss-nowphas-fetch.timer
systemctl --user enable --now wmcdss-notify-digest.timer
systemctl --user enable --now wmcdss-db-backup.timer
systemctl --user enable --now wmcdss-demo-refresh.timer
loginctl enable-linger "$USER"   # keep the timers running after logout
```

## Observe

```bash
systemctl --user list-timers 'wmcdss-jma-fetch*'
journalctl --user -u wmcdss-jma-fetch.service        -f
journalctl --user -u wmcdss-jma-fetch-marine.service -f
```

## Manual run (debug)

unit と同じ定義を使うため、まず `deploy.env` を読み込みます。こうしておくと
手動実行と systemd 実行が同じチェックアウトを指すことが保証されます。

```bash
set -a; . ~/.config/wmcdss/deploy.env; set +a

# AMeDAS
docker compose --env-file "$WMCDSS_HOME/.env.production" \
  -f "$WMCDSS_HOME/docker-compose.production.yml" \
  exec -T backend python -m app.jobs.ingest_jma

# Wave nowcast
docker compose --env-file "$WMCDSS_HOME/.env.production" \
  -f "$WMCDSS_HOME/docker-compose.production.yml" \
  exec -T backend python -m app.jobs.ingest_jma_marine
```

## Cadence rationale

### AMeDAS (`wmcdss-jma-fetch.timer`)

- `OnCalendar=*:0/10:30` — fires at HH:MM:30 every 10 minutes. AMeDAS publishes
  on the :00/:10/:20 ticks; the 30-second lag avoids racing the upstream
  publish.
- `Persistent=true` — if the host was off when a tick was due, run once at boot
  so we don't skip windows. Idempotent upserts make catch-up runs safe.

### Wave nowcast (`wmcdss-jma-fetch-marine.timer`)

- `OnCalendar=*:03:00` — fires once per hour at HH:03:00. Wave nowcast is
  generated from radar + buoy fusion which lags raw observation by ~1–2
  minutes; 3 minutes gives a comfortable margin.
- `AccuracySec=30s` — wider than AMeDAS's 15 s because a once-hourly job
  doesn't need sub-minute precision. Lets systemd batch wakeups.
- `Persistent=true` — same catch-up guarantee as AMeDAS.

### デモ観測リフレッシュ (`wmcdss-demo-refresh.timer`)

- `OnCalendar=*:5/10:00` — fires at HH:05/15/25/35/45/55. 判定 API の鮮度ガードは
  **気象 30 分 / 海象 3 時間**。10 分間隔なら 1 回失敗しても次の実行までに
  30 分を超えない（2 回連続失敗で初めて caution 固定に戻る）ため、30 分より
  十分短い 10 分を採用する。5 分間隔にしないのは、鮮度ガードに対して余裕が
  過剰で、DELETE + 49 点再投入の無駄が増えるだけだから。
- 発火分を `:05` にずらしているのは、AMeDAS(`:00/:10/:20`) と
  NOWPHAS(`:20`) の取り込みと同時に走らせないため（DB のロック競合を避ける）。
- `Persistent=true` — ホスト停止中に来た分は起動後に 1 回実行。SQL は
  何度実行しても行数が増えないよう設計されているため、catch-up 実行は安全。
- 実体は `scripts/wmcdss-demo-refresh.sh`（`docker exec wmcdss-db psql`）。
  実装・値設計・手順は `docs/DEMO-DATA.md` を参照。

## Exit code semantics

Both ingesters internally tolerate transient upstream errors (timeouts, 4xx/5xx,
connection drops) and tally them into the audit row. Exit=1 from either job
therefore means an **unexpected** exception bubbled out (programming bug,
schema drift, DB unavailable) — that **is** a real failure systemd should
surface as red. Do NOT add `SuccessExitStatus=0 1` without first removing the
in-job tolerance, or the unit will silently mask real bugs.

---

## 💾 日次 DB バックアップ (`wmcdss-db-backup`)

`docs/OPERATIONS-2026-08-12.md` §1 の **RPO 24h / 30 世代** を成立させるための
日次バックアップです。2026-09-29 の DB 検証（task-3）で「バックアップが 1 件も
無く、自動取得も未登録」だった状態（F-1）を埋めるために追加しました。

| 項目 | 値 |
| --- | --- |
| 発火 | 毎日 03:30 JST（`OnCalendar=*-*-* 03:30:00`） |
| 取りこぼし | `Persistent=true`（ホスト停止中に来た分は起動後に 1 回実行） |
| 出力先 | `${WMCDSS_HOME}/backups/wmcdss_<YYYYmmdd_HHMMSS>.sql.gz` |
| 世代数 | 30（`--keep 30`） |
| 実体 | `scripts/wmcdss-db-backup.sh --compose production --keep 30` |

### インストール（このリポジトリでは未実施 — 導入は運用判断）

unit ファイルを置くところまでが本リポジトリの成果物です。**実際の
`enable` / `start` は行っていません。** 導入する場合は次を実行します。

```bash
set -a; . ~/.config/wmcdss/deploy.env; set +a   # WMCDSS_HOME を確認
test -f "$WMCDSS_HOME/.env.production" || echo "NG: .env.production が無い"

mkdir -p ~/.config/systemd/user
cp "$WMCDSS_HOME"/deploy/systemd/wmcdss-db-backup.service \
   "$WMCDSS_HOME"/deploy/systemd/wmcdss-db-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-db-backup.timer
systemctl --user list-timers 'wmcdss-db-backup*'
```

`wmcdss.service` と同じく `~/.config/wmcdss/deploy.env` の `WMCDSS_HOME` だけを
パス源にします（unit にパスを直接書かない方針は本 README 冒頭のとおり）。

### 出力ファイルの不変条件（重要）

`backups/wmcdss_*.sql.gz` という名前のファイルは **検証済み** を意味します。
`scripts/wmcdss-db-backup.sh` は

1. 一時ファイル (`*.sql.gz.tmp.<pid>`) へ出力
2. サイズ下限 (`WMCDSS_BACKUP_MIN_BYTES`, 既定 1 KB) を確認
3. `gzip -t` で整合性を確認
4. 通過したものだけを最終名へ atomic rename

の順に進みます。失敗時は最終名を作らず、既存の正常なバックアップも壊しません。
これは「pg_dump が失敗しても 20 バイトの有効な空 gzip が最終名で残り、それを
復元しても何も起きないのに成功と表示される」という 2026-09-29 に実測した
無言の失敗（F-2）を塞ぐためです。**この順序を壊さないでください。**

### 外部退避（scp / rclone）を足す場合

unit 本体は編集せず、user drop-in で上書きします（リポジトリ側の定義を
そのまま保つため）。

```bash
systemctl --user edit wmcdss-db-backup.service
```

```ini
[Service]
ExecStart=
ExecStart=/bin/bash ${WMCDSS_HOME}/scripts/wmcdss-db-backup.sh --compose production --keep 30 --remote ops@backup-host:/backup/wmcdss
# rclone を使う場合:
# ExecStart=/bin/bash ${WMCDSS_HOME}/scripts/wmcdss-db-backup.sh --compose production --keep 30 --rclone-remote b2:wmcdss-backup
```

### 監視

`scripts/wmcdss-healthcheck.sh`（cron 10 分推奨）が、最新世代について
**サイズ下限 → `gzip -t` → 鮮度 (36h)** の順に検証し、さらに全世代のサイズ
下限を確認します。mtime だけを見る監視は廃止しました（空 gzip でも
「0h 前」で ALL OK になっていたため）。

```bash
systemctl --user list-timers 'wmcdss-db-backup*'
journalctl --user -u wmcdss-db-backup.service -n 50
ls -lt "$WMCDSS_HOME"/backups | head
```

### 手動実行（debug / 復元演習）

```bash
set -a; . ~/.config/wmcdss/deploy.env; set +a
"$WMCDSS_HOME"/scripts/wmcdss-db-backup.sh --compose production --dry-run   # 何をするか確認
"$WMCDSS_HOME"/scripts/wmcdss-db-backup.sh --compose production             # 実取得
"$WMCDSS_HOME"/scripts/wmcdss-db-restore.sh --dry-run                       # 復元対象の確認
```

**復元は既存 DB を置き換える破壊的操作です。** 演習は必ずスクラッチ DB
（名前に `_backup_check` を含める）に対して行ってください。安全性の回帰テストは

```bash
bash scripts/tests/test-backup-restore-safety.sh
```

が実 DB を変更せずに検証します（スクラッチ DB は自動で削除されます）。

---

## 🧪 デモ観測リフレッシュ (`wmcdss-demo-refresh`)

公開 MVP のデモ観測値を 10 分ごとに再投入し、3 段階判定（go/caution/stop）を
成立させ続けます。**値設計・リフレッシュ手順の正本は `docs/DEMO-DATA.md`。**

| 項目 | 値 |
| --- | --- |
| 発火 | 10 分ごと（`OnCalendar=*:5/10:00` → :05/:15/:25/:35/:45/:55） |
| 取りこぼし | `Persistent=true` |
| 実体 | `scripts/wmcdss-demo-refresh.sh`（既定は `docker exec wmcdss-db psql`） |
| 投入 SQL | `db/demo/refresh_demo_observations.sql`（`now()` 相対・冪等） |
| 削除範囲 | `source IN ('demo','demo_series')` の行のみ（DROP/TRUNCATE なし） |

### インストール（このリポジトリでは未実施 — 導入は運用判断）

unit ファイルを置くところまでが成果物です。**実際の `enable` / `start` は
行っていません。** 導入する場合は次を実行します。

```bash
set -a; . ~/.config/wmcdss/deploy.env; set +a   # WMCDSS_HOME を確認

mkdir -p ~/.config/systemd/user
cp "$WMCDSS_HOME"/deploy/systemd/wmcdss-demo-refresh.service \
   "$WMCDSS_HOME"/deploy/systemd/wmcdss-demo-refresh.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-demo-refresh.timer
systemctl --user list-timers 'wmcdss-demo-refresh*'
```

`docker-compose.production.yml` の `db` サービスではなく、コンテナ名で
`docker exec wmcdss-db` を叩く既定にしている理由は unit ファイル内のコメントを
参照（稼働中の MVP スタックは検証用 compose で起動されているため）。
compose 経路に切り替える場合は user drop-in で `ExecStart` を上書きします。

### 監視・手動実行

```bash
systemctl --user list-timers 'wmcdss-demo-refresh*'
journalctl --user -u wmcdss-demo-refresh.service -n 50
"$WMCDSS_HOME"/scripts/wmcdss-demo-refresh.sh --dry-run   # 対象と現在の行数だけ確認
"$WMCDSS_HOME"/scripts/wmcdss-demo-refresh.sh             # 実リフレッシュ
curl -fsS -X POST http://127.0.0.1:18003/api/v1/auth/demo-login \
  -H 'Content-Type: application/json' -d '{}'             # MVP の demo JWT
```

`GET /api/v1/dashboard` の `sites[].status` に go / caution / stop が
揃っていることが復旧の判定基準です（1 状態しか出なければ鮮度切れを疑う）。
