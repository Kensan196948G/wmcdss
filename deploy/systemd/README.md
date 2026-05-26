# WMCDSS — systemd units

User-level units that drive the periodic JMA observation ingest. They wrap a
`docker compose exec backend python -m app.jobs.ingest_jma` invocation, so the
job runs inside the same Python environment and DB connection pool as the API.

## Install (user mode — no root needed)

```bash
mkdir -p ~/.config/systemd/user
cp wmcdss-jma-fetch.service wmcdss-jma-fetch.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
loginctl enable-linger "$USER"   # keep the timer running after logout
```

## Observe

```bash
systemctl --user list-timers wmcdss-jma-fetch.timer
journalctl --user -u wmcdss-jma-fetch.service -f
```

## Manual run (debug)

```bash
docker compose -f ~/Projects/Weather-Marine-Construction-Decision-Support-System/docker-compose.yml \
  exec -T backend python -m app.jobs.ingest_jma
```

## Cadence rationale

- `OnCalendar=*:0/10:30` — fires at HH:MM:30 every 10 minutes. AMeDAS publishes
  on the :00/:10/:20 ticks; the 30-second lag avoids racing the upstream
  publish.
- `Persistent=true` — if the host was off when a tick was due, run once at boot
  so we don't skip windows. Idempotent upserts (`ON CONFLICT site_id+observed_at+data_version`)
  make catch-up runs safe.
- `SuccessExitStatus=0 1` — JMA's public endpoints are best-effort; we don't
  want a transient 502 to leave the timer in a "failed" state.
