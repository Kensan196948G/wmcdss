# WMCDSS — systemd units

## 🚀 WebUI + API 起動サービス

`wmcdss.service` — Docker Compose 全体（WebUI + API + DB）を OS 起動時に自動起動します。

```bash
# インストール
mkdir -p ~/.config/systemd/user
cp wmcdss.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss.service
sudo loginctl enable-linger $USER   # ログインなしで常時起動
```

**アクセス URL**（IP は `ip addr show` で確認）:

- WebUI: `http://<LAN-IP>:9080`
- API: `http://<LAN-IP>:8003`

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

The split mirrors the upstream contract — AMeDAS is per-station 10-min cadence,
wave is gridded hourly. Diverging the timers (instead of one combined job)
keeps each ingester's failure mode independent in `audit_log`.

## Install (user mode — no root needed)

```bash
mkdir -p ~/.config/systemd/user
cp wmcdss-jma-fetch.service        wmcdss-jma-fetch.timer        ~/.config/systemd/user/
cp wmcdss-jma-fetch-marine.service wmcdss-jma-fetch-marine.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
systemctl --user enable --now wmcdss-jma-fetch-marine.timer
loginctl enable-linger "$USER"   # keep the timers running after logout
```

## Observe

```bash
systemctl --user list-timers 'wmcdss-jma-fetch*'
journalctl --user -u wmcdss-jma-fetch.service        -f
journalctl --user -u wmcdss-jma-fetch-marine.service -f
```

## Manual run (debug)

```bash
# AMeDAS
docker compose -f ~/Projects/Weather-Marine-Construction-Decision-Support-System/docker-compose.yml \
  exec -T backend python -m app.jobs.ingest_jma

# Wave nowcast
docker compose -f ~/Projects/Weather-Marine-Construction-Decision-Support-System/docker-compose.yml \
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
