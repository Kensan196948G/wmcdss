# WMCDSS 運用基準（2026-08-12 策定）

> 対象: パイロット〜本番運用。7名のIT・DX部門で少人数継続運用するための最小基準。

## 1. RTO / RPO（目標値・パイロット版）

| 項目 | 目標 | 備考 |
|---|---|---|
| RPO（許容データ損失） | **24時間** | 日次バックアップ + 観測データは上流（JMA/NOWPHAS）から再取得可能 |
| RTO（復旧目標） | **4時間以内** | compose 再起動・リストア・smoke まで |
| バックアップ世代 | 30世代（約30日） | `wmcdss-db-backup.sh --keep` |
| 外部退避 | 日次（scp/rclone） | サーバー障害時のデータ消失防止（本評価でスクリプト対応） |
| 復旧ドリル | 四半期1回 | `wmcdss-db-restore.sh --dry-run` 確認 + 実地ドリル1回 |

## 2. 監視構成（最小）

| 監視対象 | 方法 | 閾値 | アラート |
|---|---|---|---|
| API死活 | `scripts/wmcdss-healthcheck.sh`（/readyz） | 10秒タイムアウト | cron 10分 + Uptime Kuma（導入時） |
| バックアップ鮮度 | 同スクリプト | 36時間以上古いとNG | cron 日次 |
| 観測鮮度（気象） | `/api/v1/etl/status` | 30分超で stale | 手動確認（Phase 1 で通知化） |
| 観測鮮度（海象NOWPHAS） | 同上（job 3） | 2時間超で stale | 手動確認 |
| 依存脆弱性 | pip-audit / npm audit（CI） | Critical/High | CI 失敗 |

推奨 cron（サーバー内）:
```bash
*/10 * * * * /path/wmcdss/scripts/wmcdss-healthcheck.sh >> /var/log/wmcdss-health.log 2>&1
30 3 * * *  /path/wmcdss/scripts/wmcdss-db-backup.sh --remote ops@backup-host:/backup/wmcdss >> /var/log/wmcdss-backup.log 2>&1
```

## 3. インシデント対応（簡易 Runbook）

### 3.1 バックエンド 503 / 起動失敗
1. `docker compose -f docker-compose.production.yml ps` で状態確認
2. `docker compose logs backend --tail 200` で原因特定（DB接続・migration・AI設定ファイル）
3. 環境変数・`.env.production` の不備 → 修正後 `docker compose up -d --build`
4. `/readyz` 200 を確認 → `scripts/wmcdss-healthcheck.sh` で正常化確認

### 3.2 DB 消失・破損
1. バックアップ確認: `ls -lt backups/wmcdss_*.sql.gz`（外部退避先も確認）
2. 復元: `scripts/wmcdss-db-restore.sh backups/wmcdss_最新.sql.gz`
3. smoke: `/readyz` 200・現場一覧・判定API・`/api/v1/etl/status`
4. 事後: 原因を `docs/ops-incidents.md` へ記録（新規作成）

### 3.3 観測データ欠測（NOWPHAS/JMA）
1. `GET /api/v1/etl/status`（要ログイン）で job 別 status 確認
2. systemd: `systemctl --user list-timers 'wmcdss-*'` / `journalctl --user -u wmcdss-nowphas-fetch`
3. 上流障害が続く場合は本システムの判定は安全側（caution）へ倒れるため、作業可否は現場判断に委ねる

## 4. バックアップ・リストア手順（外部退避込み）

```bash
# ローカル保存 + scp 退避（本番）
scripts/wmcdss-db-backup.sh --remote ops@backup-host:/backup/wmcdss

# rclone 利用時（例: Backblaze B2）
scripts/wmcdss-db-backup.sh --rclone-remote b2:wmcdss-backup

# 復元（破壊的操作。事前に最新バックアップの存在を確認）
scripts/wmcdss-db-restore.sh --dry-run
scripts/wmcdss-db-restore.sh backups/wmcdss_YYYYMMDD_HHMMSS.sql.gz
```

## 5. 残課題（Phase 1 で対応）
- 監視アラートの実通知（Uptime Kuma / Cloudflare Healthcheck 等の導入先決定）
- 復旧ドリルの実地実施と結果記録
- RTO/RPO の実測（ドリル後に更新）
- 障害履歴の蓄積（docs/ops-incidents.md）
