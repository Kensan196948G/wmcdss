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
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
systemctl --user enable --now wmcdss-jma-fetch-marine.timer
systemctl --user enable --now wmcdss-nowphas-fetch.timer
systemctl --user enable --now wmcdss-notify-digest.timer
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

## Exit code semantics

Both ingesters internally tolerate transient upstream errors (timeouts, 4xx/5xx,
connection drops) and tally them into the audit row. Exit=1 from either job
therefore means an **unexpected** exception bubbled out (programming bug,
schema drift, DB unavailable) — that **is** a real failure systemd should
surface as red. Do NOT add `SuccessExitStatus=0 1` without first removing the
in-job tolerance, or the unit will silently mask real bugs.
