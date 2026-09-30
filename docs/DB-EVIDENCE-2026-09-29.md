# DB 検証エビデンス — Local PostgreSQL (WMCDSS)

- 検証日時: 2026-09-29 23:19〜23:30 JST
- 担当: db-verifier（Task Passport / task-3）
- 対象: `wmcdss` スタックの Local PostgreSQL
- 制約遵守: **破壊的操作なし**（DROP DATABASE / DROP SCHEMA / DROP TABLE / TRUNCATE / 大量 DELETE / 既存データ変更 / 本番DBへのリストアは一切実施していない）。コンテナの再起動・削除・再作成なし。secret（JWT_SECRET / ENTRA_CLIENT_SECRET / LOCAL_USERS ハッシュ / API キー）は出力に含めない。git commit / push なし。

---

## 1. 検証環境

| 項目 | 値 |
|---|---|
| ホスト | `/home/kensan/Projects/Mirai-Admin-Platform/wmcdss` |
| コンテナ | `wmcdss-db` (postgres:16-alpine) / healthy / `127.0.0.1:5434->5432` |
| サーバ | PostgreSQL 16.14 on x86_64-pc-linux-musl |
| DB / ロール | `wmcdss` / `wmcdss`（compose 既定。接続は loopback 経由） |
| 稼働スタック | `wmcdss-db` / `wmcdss-backend` (127.0.0.1:18003, healthy) / `wmcdss-frontend` (127.0.0.1:19080, healthy) / `wmcdss-mvp-tunnel` |
| compose プロジェクト | `wmcdss-verify`（config file: `/tmp/wmcdss-verify/docker-compose.patched.yml`。リポジトリ内 compose ではない） |
| DB サイズ | 8671 kB / max_connections=100 / 現在 8 接続 / ssl=off / TimeZone=Asia/Tokyo |
| テーブル | audit_log, decisions, etl_runs, forecasts, marine_observations, schema_migrations, sites, thresholds, users, weather_observations（10） |

### 検証前後の行数（自分が作った行はすべて後始末済み）

| テーブル | 検証前 | 検証後 | 差分 |
|---|---|---|---|
| sites | 6 | 6 | 0 |
| thresholds | 11 | 11 | 0 |
| weather_observations | 301 | 301 | 0 |
| marine_observations | 250 | 250 | 0 |
| decisions | 50 | 50 | 0 |
| audit_log | 56 | **60** | **+4（後述 F-9。API 検証で発生した追記専用の監査行）** |
| users / etl_runs / forecasts | 0 | 0 | 0 |
| schema_migrations | 5 | 5 | 0 |

- 残存した検証用オブジェクト: `sites` の `verify-%` = 0 件 / `thresholds` の `verify%` = 0 件 / スクラッチ DB = 0 件。
- `backups/` ディレクトリは検証開始前・終了後ともに **空**（検証中に発生した空ファイルは削除済み）。

---

## 2. 検証項目ごとの結果

### 項目 1. Connection / ロール・権限 — 実施

**実施コマンド（要約）**

```
docker exec wmcdss-db psql -U wmcdss -d wmcdss -c "select version();"
docker exec wmcdss-db psql -U wmcdss -d wmcdss -c "\du"
docker exec wmcdss-db psql -U wmcdss -d wmcdss -c "select rolname,rolsuper,... from pg_roles ..."
docker exec wmcdss-db psql -U wmcdss -d wmcdss -c "select tablename,tableowner from pg_tables ..."
docker exec wmcdss-db sh -c "grep -vE '^\s*#|^\s*$' /var/lib/postgresql/data/pg_hba.conf"
```

**結果**

- `version()` = `PostgreSQL 16.14`、接続成功（`current_user`=`session_user`=`wmcdss`、`current_database`=`wmcdss`）。
- ロールは **`wmcdss` の 1 つのみ**。`postgres` ロールは存在しない。
  - `wmcdss`: `rolsuper=t, rolcreaterole=t, rolcreatedb=t, rolcanlogin=t, rolbypassrls=t`
- オブジェクト所有権: `public` スキーマは `pg_database_owner`、DB `wmcdss` の所有者は `wmcdss`、**10 テーブル全ての所有者が `wmcdss`**。テーブル ACL は全て既定（所有者のみ、`relacl` NULL）。
- `pg_hba.conf`: `local` / `127.0.0.1/32` / `::1/128` は **`trust`**（パスワード不要）、それ以外のホストは `scram-sha-256`。

**判定: ✗ 期待に反する（タスクの期待「wmcdss が SUPERUSER でないこと」を満たさない）**

→ **F-3** として後述。`127.0.0.1` バインドのみ公開・開発スタック・postgres 公式イメージの既定挙動という緩和要因はあるが、**アプリ接続ロールがクラスタ管理者権限を持ち、かつ loopback が trust** である事実は変わらない。

---

### 項目 2. Schema（0001_init.sql と実 DB の機械的突き合わせ） — 実施

**実施内容** `information_schema.columns` を JSON で取得し、`db/migrations/*.sql` の `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` を構文解析して、テーブル・列・型・NOT NULL・DEFAULT を機械的に突き合わせた（パーサは `double precision` / `PRIMARY KEY ⇒ NOT NULL` / `bigserial ⇒ bigint + nextval` を正しく解釈するよう補正済み）。

**結果**

- 宣言 9 テーブル / 実 DB 10 テーブル。
- **実質差分 4 件のみ**で、すべて `schema_migrations`（`version`/`checksum`/`applied_at`/`applied_by`）に関するもので、これは `backend/app/db/migrate.py` の `_CREATE_TABLE_SQL` が作るテーブル（migration ファイルには含まれない）。**設計どおり**。
- `0001_init.sql` の型・列の欠落/余剰: **0 件**。
- 追加列 `marine_observations.station_code` は `0003_nowphas_station.sql` の `ADD COLUMN IF NOT EXISTS` と一致。
- DEFAULT 値も全列一致（差分表示されたものは `bigserial` の `nextval(...)` のみで、これは serial の正常な実装。`'jma'`→`'jma'::text` 等は型注釈の差のみ）。
- 全 10 テーブルの列数合計 95。`information_schema` 取得結果は取得時点のスナップショット。

**判定: ✓ 合格（0001 定義と実 DB は乖離なし）**

---

### 項目 3. Migration（checksum 検証 / down の有無） — 実施

**実施内容** `backend/app/db/migrate.py`（379 行）を読了し、以下を実行。

1. リポジトリの migration 5 ファイルの SHA-256 を `migrate.checksum_of` と同一規約（CRLF→LF 正規化後 UTF-8）で再計算し、`schema_migrations.checksum` と照合。
2. `python -m app.db.migrate status` を実 DB に対して実行（ホスト実行・コンテナ実行の 2 経路）。
3. 改竄コピーによる drift 検出の fail-closed 動作を検証。

**結果**

```
リポジトリ 5 ファイルの再計算 checksum → 5 件すべて schema_migrations の記録と MATCH
（0001 75d203b3… / 0002 1a85d82c… / 0003 06ff2083… / 0004 88dafbd1… / 0005 67d0c159…）
記録のみでファイルが無い orphan: なし
```

```
$ PYTHONPATH=backend WMCDSS_DATABASE_URL=postgresql+asyncpg://wmcdss:***@127.0.0.1:5434/wmcdss \
  WMCDSS_MIGRATIONS_DIR=$PWD/db/migrations python3 -m app.db.migrate status
検出: 5 件 / 適用済み: 5 件 / 未適用: 0 件        EXIT=0
```

```
$ docker exec -e WMCDSS_MIGRATIONS_DIR=/tmp/dbver_migrations wmcdss-backend python -m app.db.migrate status
検出: 5 件 / 適用済み: 5 件 / 未適用: 0 件        EXIT=0   （コンテナ実効ユーザー uid=999(appuser) で実行）
$ docker exec -e WMCDSS_MIGRATIONS_DIR=/tmp/dbver_migrations wmcdss-backend python -m app.db.migrate up
検出: 5 件 / 適用済み: 5 件 / 未適用: 0 件
適用対象なし                                      EXIT=0   （schema_migrations の applied_at は不変）
```

`status` / `up` は `plan.needs_baseline` / `plan.drifted` を検出すると `return 1` する実装であり、EXIT=0 は「未適用 0 件・drift 0 件・orphan 0 件」を意味する。

**drift 検出の fail-closed 実証**（本番ファイルは触らず、`/tmp` に複製して 0001 にコメント 1 行を追記して実行）:

```
検出: 5 件 / 適用済み: 5 件 / 未適用: 0 件
適用済み migration の内容が変更されている: 0001_init.sql
適用済みファイルは書き換えず、新しい番号のファイルを追加すること。   EXIT=1
```

**down / rollback: 存在しない。** `migrate.py` のサブコマンドは `choices=("up","status","baseline")` のみ。`db/migrations/` に down 用 SQL は 1 件も無く、`db/migrations` 配下・`scripts/` 配下に rollback/down の実装は無い。`docs/TECHNICAL.md` §rollback に「**down migration は用意していない**（DROP COLUMN が復元不能なデータ損失になる経路を常時抱えるため）」と明記され、復旧は pg_dump からのリストアに一本化する設計が文書化されている。

**判定: ✓ 合格（checksum 検証は機能しており、適用済み 5 件すべて一致・drift 検出も fail-closed）。ただし down migration は無し（設計判断であり欠陥ではないが、復旧手段が pg_dump のみに依存する）。**

---

### 項目 4. Constraint / Integrity — 実施

**列挙結果（29 制約）**

- PRIMARY KEY: 10（全テーブル）
- UNIQUE: 5 — `sites(code)`, `users(email)`, `weather_observations(site_id,observed_at,data_version)`, `marine_observations(site_id,observed_at,data_version)`, `forecasts(site_id,forecast_for,issued_at,domain)`
- FOREIGN KEY: 5 — `weather_observations`, `marine_observations`, `forecasts`, `decisions`, `thresholds` の各 `site_id → sites(id) ON DELETE CASCADE`
- CHECK: 9 — `sites(kind)`, `sites(lat範囲)`, `sites(lon範囲)`, `thresholds(op)`, `thresholds(severity)`, `decisions(status)`, `forecasts(domain)`, `etl_runs(status)`, `users(role)`

**非破壊 probe（`BEGIN` → `DO` ブロックで SQLSTATE 捕捉 → `ROLLBACK`、COMMIT なし）**

| # | 違反内容 | 期待 | 実測 |
|---|---|---|---|
| P1 | 存在しない `site_id` への FK 参照 INSERT | 23503 | **23503** foreign key constraint "weather_observations_site_id_fkey" |
| P2 | `sites.kind='submarine'` | 23514 | **23514** check constraint "sites_kind_check" |
| P3 | `sites.lat=123` | 23514 | **23514** check constraint "sites_lat_check" |
| P4 | 既存 `code='TYO-01'` の重複 INSERT | 23505 | **23505** unique constraint "sites_code_key" |
| P5 | `weather_observations.observed_at = NULL` | 23502 | **23502** not-null constraint |
| P6 | `thresholds.severity='fatal'` | 23514 | **23514** check constraint "thresholds_severity_check" |

6/6 が期待どおりブロックされた。トランザクション内カウントは `sites=7`、ROLLBACK 後は `sites=6`（元に戻る）。`verify-%` の残存行 0 件。

**データ実体の整合性（読み取りのみ）**

- 孤児行（FK 先が存在しない行）: weather / marine / decisions / forecasts / thresholds **すべて 0 件**。
- CHECK 対象の値域逸脱: 8 分類すべて **0 件**。
- UNIQUE 対象の実データ重複: weather / marine / sites.code **すべて 0 件**。
- シーケンス健全性: `marine_observations` seq=250 / max(id)=250、`audit_log` seq=60 / max(id)=60（`weather_observations` seq=304 / max(id)=302 は ON CONFLICT DO NOTHING による ID 欠番と、後述のロールバック済み probe が消費した値によるもので異常ではない）。
- トリガ: `trg_sites_updated` / `trg_thresholds_updated`（`set_updated_at()`）が存在し `tgenabled='O'`。**実挙動も確認** — `created_at` を 2 日前に固定して INSERT→UPDATE したところ `updated_at` がトランザクション時刻へ更新された（`bumped=t`）。※ `now()` はトランザクション内で固定のため、同一トランザクション内の INSERT→UPDATE では `updated_at == created_at` になり得る（誤検知しやすい点に注意）。

**判定: ✓ 合格**

---

### 項目 5. Index — 実施

**結果（24 インデックス）**

| テーブル | インデックス |
|---|---|
| sites | `sites_pkey(id)`, `sites_code_key(code)`, `idx_sites_kind(kind)` |
| weather_observations | pkey, UNIQUE(site_id,observed_at,data_version), `idx_weather_site_time(site_id, observed_at DESC)` |
| marine_observations | pkey, UNIQUE(site_id,observed_at,data_version), `idx_marine_site_time(site_id, observed_at DESC)`, `idx_marine_station_code(station_code)` |
| forecasts | pkey, UNIQUE(site_id,forecast_for,issued_at,domain), `idx_forecasts_lookup(site_id, domain, forecast_for)` |
| thresholds | pkey, `idx_thresholds_lookup(site_id, work_type, metric)` |
| decisions | pkey, `idx_decisions_site_time(site_id, target_window_start DESC)` |
| audit_log | pkey, `idx_audit_time(occurred_at DESC)` |
| etl_runs | pkey, `idx_etl_runs_job_time(job, started_at DESC)` |
| users | pkey, `users_email_key(email)` |
| schema_migrations | pkey |

- **FK 列の被覆: 5/5 すべて先頭列としてインデックスあり**（未被覆 0 件）。
- 検索頻出列 `site_id`, `observed_at` は複合インデックスの先頭/第 2 列で被覆済み。

**実行計画（実測）**

- `SELECT * FROM weather_observations WHERE site_id=$1 ORDER BY observed_at DESC LIMIT 49` → **Seq Scan**（Filter で 250 行除外、Execution 0.257 ms、テーブル 176 kB / 301 行）
- 同 marine → Seq Scan（0.114 ms）
- `decisions` 全件 ORDER BY generated_at DESC LIMIT 20 → Seq Scan + top-N heapsort（0.164 ms）
- `thresholds WHERE work_type='crane'` → Seq Scan（0.019 ms）
- `SET enable_seqscan=off` で強制すると weather/marine とも `Bitmap Index Scan on idx_weather_site_time` / `idx_marine_site_time` が使われる（インデックスは有効）。

**判定: ✓ 合格（現状の規模では Seq Scan が妥当）。** 判定根拠: 最大テーブルでも 301 行 / 176 kB で、6 現場しかないため 1 現場あたり選択率が約 17% になり、プランナが Seq Scan を選ぶのは合理的。**現時点で性能問題はない**。ただし site 数・観測行数が増えれば同じインデックスが使われるため、将来の懸念もない。注意点として、`thresholds(site_id, work_type, metric)` は NULL 可能な `site_id` を含む複合インデックスで、`site_id IS NULL`（全 11 行が GLOBAL）の検索では先頭列が定数にならないため効きにくい（現規模では無害）。

---

### 項目 6. Transaction（原子性） — 実施

`BEGIN` 内で `verify-probe-tx` という一時 site を INSERT し、`SELECT count(*) FROM sites` が **7** になることを確認 → `ROLLBACK` → 再度カウントして **6** に戻ることを確認。差分テーブルで確認したとおり他テーブルも変化なし。

**判定: ✓ 合格（明示トランザクションの原子性を実測で確認）**

---

### 項目 7. Read / Write（HTTP API 経由） — 実施

**前提**: JWT は `app.core.auth.create_access_token(subject="verify", auth_type="local", role="admin")` をコンテナ内で生成（トークン値は出力していない）。エンドポイントは `http://127.0.0.1:18003`。**backend/ 配下は他担当（backend-sec）が編集中のため読み取りのみ**。

**Read（HTTP、実行したもの）**

| エンドポイント | 結果 |
|---|---|
| `GET /healthz` | 200 `{"status":"ok"}` |
| `GET /readyz` | 200 `{"status":"ready","db":"ok"}`（DB 疎通確認を含む） |
| `GET /api/v1/sites` (Bearer admin) | 200 / 6 件 / `TYO-01..TYO-06` / 列は address, code, created_at, id, jma_station_id, kind, lat, lon, name, note, updated_at |
| `GET /api/v1/sites/{id}` | 200 |
| `GET /api/v1/thresholds` | 200 / 11 件（すべて `site_id IS NULL` のグローバル既定） |
| `GET /api/v1/observations/weather?site_id=…&t0=2026-08-01&t1=2026-10-01&limit=500` | 200 / 50 件（列: data_version, fetched_at, humidity_pct, id, observed_at, precip_mm, pressure_hpa, site_id, source, sunshine_h, temperature_c, wind_dir_deg, wind_gust_ms, wind_speed_ms） |
| `GET /api/v1/observations/marine/latest?site_id=…` | 200（sig_wave_h_m 等を返却） |
| `GET /api/v1/audit?t0=2026-08-01&t1=2026-10-01&limit=10` | 200 / 10 件（threshold.delete, threshold.update, threshold.create, site.create, decision.create ×6） |
| `GET /api/v1/dashboard` | 200 / count=6 / status 分布 **caution=6** |
| `GET /api/v1/decisions?limit=3` | **405**（`decisions` ルータは評価実行の `POST` のみを公開しており GET は未定義。仕様どおり） |

**Write（HTTP、作成→取得→更新→削除をすべて実施し、自分の行だけ後始末）**

| # | 操作 | 結果 |
|---|---|---|
| W1 | `POST /api/v1/sites` `verify-api-site` | **201**（id 取得） |
| W2 | `GET /api/v1/sites/{id}` | 200 |
| W3 | 同一 `code` で再 `POST` | **409**（アプリ側でも重複を拒否） |
| W4 | `POST /api/v1/thresholds`（`work_type=verify_probe`, site_id=作成した site） | **201** |
| W5 | `PATCH /api/v1/thresholds/{id}` `{"value":98.0}` | **200** / value=98.0 / `updated_at != created_at`（`set_updated_at` トリガの発火が API 経由でも確認できた） |
| W6 | `DELETE /api/v1/thresholds/{id}` | **204** |
| W7 | 削除後の `GET /api/v1/thresholds/{id}` | **404** |
| W8 | 作成した site を SQL で削除（`sites` に DELETE API が存在しないため）: `DELETE FROM sites WHERE id=… AND code='verify-api-site'` | `DELETE 1` |

- 終了時の `sites=6` / `thresholds=11` を実測で確認（検証前と一致）。`verify-%` 残存 0 件。
- 副作用: `audit_log` が 56 → **60**。内訳は `site.create` / `threshold.create` / `threshold.update` / `threshold.delete` の 4 行で、`write_audit(strict=True)` により API 操作として正規に記録されたもの。**追記専用の監査証跡であるため削除していない**（→ F-9）。

**判定: ✓ 合格（主要 Read/Write が HTTP API 経由で動作。Write はすべて自分の行のみで後始末済み）**

---

### 項目 8. Backup / Restore — 一部実施（スクリプト本体は実行不能、等価コマンドで往復検証は実施）

**スクリプトの評価（読了 + dry-run 実行）**

- `scripts/wmcdss-db-backup.sh`（180 行）: `docker compose --env-file <env> -f <compose> exec -T db pg_dump --clean --if-exists -U <user> <db> | gzip > backups/wmcdss_<ts>.sql.gz`。既定は **production compose + `.env.production` + DB ユーザー `wmcdss_app`**。`--compose dev` で dev compose + `.env` + `wmcdss`。作成直後に `gzip -t` で整合性検証し、失敗すれば非ゼロ終了。`--remote`(scp) / `--rclone-remote` で外部退避、`--keep`（既定 30）で世代管理。`--dry-run` あり。
- `scripts/wmcdss-db-restore.sh`（120 行）: 引数なしなら `backups/wmcdss_*.sql.gz` の**最新**（`ls -1t | head -1`）を選び、`gunzip -c | docker compose ... exec -T db psql -v ON_ERROR_STOP=1` で**既存 DB を置換**。`--dry-run` あり、`gzip -t` 事前検証あり。
- 危険性: ダンプは `--clean --if-exists` 形式のため **復元先の既存オブジェクトを DROP してから CREATE する**。本番 DB への復元は完全な破壊的操作であり、`docs/TECHNICAL.md` も「復元は既存データを置き換える破壊的操作」と明記している。**本検証では本番 DB へ一切リストアしていない。**

**スクリプト本体の実行可否（実測）**

```
$ ./scripts/wmcdss-db-backup.sh --compose dev            → EXIT=1
  couldn't find env file: .../wmcdss/.env
$ ./scripts/wmcdss-db-backup.sh --dry-run                → EXIT=0（dry-run は docker compose を呼ばないため成功）
$ ./scripts/wmcdss-db-restore.sh --dry-run               → EXIT=1
  ERROR: 復元対象のバックアップが見つかりません（.../backups/wmcdss_*.sql.gz）
$ docker compose -f docker-compose.yml exec -T db pg_isready → EXIT=1
  service "db" is not running
```

→ **スクリプト本体はこの環境では実行できない**（`.env` / `.env.production` が存在しない。加えて稼働スタックは project `wmcdss-verify` として `/tmp` の patched compose から起動されており、リポジトリ compose の project とは一致しないため `compose exec db` が対象を見つけられない）。**そのため「スクリプト経由のバックアップ/リストア」は未実施**（理由は上記）。

**代替: スクリプトと同一のコマンド列による往復検証（実施）**

スクリプトが実行するコマンドと等価なものを、許容された可逆操作（新規スクラッチ DB）で実行した。

```
1) docker exec wmcdss-db pg_dump --clean --if-exists -U wmcdss wmcdss | gzip > /tmp/dbver_wmcdss_backup.sql.gz
   → EXIT=0 / 24,334 bytes / sha256 744bed3129864e0266462ee4a752931ba58e3b8789b5587d3e13e29039e55009
   → gzip -t: PASS
   → ダンプ内の `\connect` 行 = 0 / `DROP DATABASE` 行 = 0 / `CREATE TABLE` = 10
2) docker exec wmcdss-db createdb -U wmcdss wmcdss_restore_check      → OK
3) gunzip -c <dump> | docker exec -i wmcdss-db psql -v ON_ERROR_STOP=1 -U wmcdss -d wmcdss_restore_check
   → EXIT=0 / ERROR 0 件
4) 比較（本番 `wmcdss` vs スクラッチ `wmcdss_restore_check`）
   - 行数: audit_log=60, decisions=50, etl_runs=0, forecasts=0, marine=250,
           schema_migrations=5, sites=6, thresholds=11, users=0, weather=301  → 完全一致
   - schema_migrations checksum 5 件: 完全一致
   - constraints=29 / indexes=24 / tables=10 / triggers=2 → 完全一致
   - シーケンス weather_observations_id_seq: last_value=304, is_called=true → 一致
5) docker exec wmcdss-db dropdb -U wmcdss wmcdss_restore_check        → OK（スクラッチ DB 0 件を確認）
6) /tmp のダンプと一時ファイルを削除
```

**判定: △ 部分実施 — 等価コマンドでの往復（バックアップ→スクラッチ復元→完全一致→スクラッチ削除）は成功。スクリプト本体の実行は環境要因で未実施。**

**重要な否定的発見**: スクリプトの**失敗時挙動**に無言の失敗経路がある（→ F-2）。実測として、`.env` 不在で失敗した `wmcdss-db-backup.sh --compose dev` は `backups/wmcdss_20260929_232228.sql.gz` を **20 バイトの「有効な空 gzip」として残した**。

```
$ ls -l  backups/wmcdss_20260929_232228.sql.gz     → 20 bytes
$ sha256sum …                                       → 59869db34853933b239f1e2219cf7d431da006aa919635478511fabbfc8849d2
$ gzip -t …                                         → PASS（空ストリームは正当な gzip）
$ gzip -dc … | wc -c                                → 0
$ WMCDSS_HEALTH_URL=http://127.0.0.1:18003/readyz ./scripts/wmcdss-healthcheck.sh
  [healthcheck] /readyz OK
  [healthcheck] 最新バックアップ 0h 前: .../wmcdss_20260929_232228.sql.gz
  [healthcheck] ALL OK                              → EXIT=0   ← 空バックアップでも「健全」と判定
$ （空 gzip をスクラッチ DB へ流した場合）gunzip -c | psql -v ON_ERROR_STOP=1
  → EXIT=0、出力なし、sites の件数は変化なし
```

つまり restore.sh の `gzip -t` 検証はこの空ファイルを **PASS させ**、`psql` も空入力で **EXIT=0** を返すため、**restore.sh は「restore done」と表示しつつ実際には何も復元しない**。この空ファイルは検証後に削除し、`backups/` を元の空状態へ戻した。

---

### 項目 9. Rollback — 実施（能力評価）

- **down migration は存在しない**。`migrate.py` のサブコマンドは `up` / `status` / `baseline` のみ。`db/migrations/` は forward-only の 5 ファイル。リポジトリ全体（`db/`, `scripts/`, `backend/app/db/`）に down/rollback 実装は無い。
- `docs/TECHNICAL.md` §rollback に設計判断が明記されている: 「**down migration は用意していない。** SQL の逆操作を自動生成すると `DROP COLUMN` が復元不能なデータ損失になる経路を常時抱えることになるため」。手順は (1) 書き込み側を停止 → (2) 事前バックアップから復元 → (3) アプリイメージを同コミットへ戻す、の 3 段。
- もう一つの統制として `migrate.up` は適用済みファイルの drift を検出すると EXIT=1 で停止する（項目 3 で実証済み）。また `baseline` は二重実行・スキーマ無しでの実行を拒否する（コード読解で確認）。
- `docs/OPERATIONS-2026-08-12.md` は RPO 24h / RTO 4h / 30 世代 / 四半期ドリルを目標として定義し、`scripts/wmcdss-healthcheck.sh` にバックアップ鮮度（36h 上限）監視を持たせている。

**現状の能力評価**

| 能力 | 状態 |
|---|---|
| スキーマ変更の自動ロールバック | **無し**（設計判断。文書化済み） |
| 手動ロールバック（バックアップ復元） | **手順は文書化されているが、実行可能なバックアップが存在しない**（F-1）。さらに復元を担うスクリプトは本環境で実行不能（F-6） |
| 復旧の実地検証 | 等価コマンドでのスクラッチ往復は成功（項目 8）。**実スクリプトでの実地ドリルは未実施** |

**判定: △ 部分合格 — 手段の設計・文書化は妥当だが、実際にロールバックできる状態（有効なバックアップの存在と自動取得）が整っていない。**

---

## 3. 発見事項（Severity 付き）

| ID | Sev | 内容 | 根拠（実測） |
|---|---|---|---|
| **F-1** | **High** | **DB バックアップが 1 件も存在せず、自動取得も設定されていない。** `backups/` は空。`crontab -l` に wmcdss のエントリなし。systemd timer/unit に wmcdss なし。`docs/OPERATIONS` が掲げる **RPO 24h が現状未達成**（バックアップが 1 件も無いため RPO は実質無限）。ロールバック手段も pg_dump のみに依存しているため、復旧地点が存在しない。 | `ls -A backups/` → 0 件。`crontab -l` / `systemctl list-timers` に該当なし。`wmcdss-healthcheck.sh` 実行 → `ERROR: バックアップが 1 件も見つかりません` EXIT=1 |
| **F-2** | **High** | **バックアップ失敗時に「有効な空 gzip」が残り、整合性チェックと鮮度監視をすり抜ける。** `pg_dump | gzip > file` のリダイレクトでファイルが先に作られるため、pg_dump 失敗時も 20 バイトの正当な空 gzip が残る。`gzip -t` は PASS、`wmcdss-healthcheck.sh` は mtime しか見ないため「0h 前」で ALL OK、`restore.sh` は最新ファイルを選び `gzip -t` を通過させ、空入力を `psql -v ON_ERROR_STOP=1` に流して **EXIT=0 →「restore done」と表示**する。**復元したつもりで何も復元されていない事故**につながる。 | 20 bytes の空 gzip を実際に生成・検証（hash 59869db3…、`gzip -t` PASS、展開 0 バイト、healthcheck ALL OK、psql EXIT=0 で件数不変） |
| **F-3** | **Medium** | **`wmcdss` ロールが SUPERUSER（クラスタ唯一のロール、`postgres` ロールも不在）。** アプリ接続ユーザーが `rolsuper/rolcreaterole/rolcreatedb/rolbypassrls = true` を持つ。加えて `pg_hba.conf` は `local` / `127.0.0.1/32` / `::1/128` が **trust**（パスワード不要）。ホスト上の任意のローカルプロセスが無認証でクラスタ管理者になれる。緩和要因: 公開は `127.0.0.1:5434` のみ、開発スタック、postgres 公式イメージの既定挙動。 | `select rolname,rolsuper,… from pg_roles` → `wmcdss|t|t|t|t|t`。`\du` → `Superuser, Create role, Create DB, Replication, Bypass RLS`。`pg_hba.conf` の loopback = trust。全 10 テーブルの所有者が `wmcdss` |
| **F-4** | **Medium** | **このスタックの `db-migrate` one-shot が EXIT=1 で失敗した記録が残っている。** `PermissionError: [Errno 13] Permission denied: '/migrations/0004_demo_observations.sql'`。原因はコンテナ実行ユーザー **uid=999(appuser)** とホスト側ファイル権限（uid 1000, 当時 0600 相当）の不一致。**現在は解消済み** — 全 migration が 644 で、`migrate status/up` をコンテナ実効ユーザーで実行して EXIT=0 を確認。ただし compose は `backend.depends_on: db-migrate: service_completed_successfully` のため、**同種の権限ずれが再発すると backend が起動せずデプロイ全体が止まる**（静かなスキーマ乖離を防ぐ設計意図どおりの fail-closed ではある）。 | `docker inspect wmcdss-db-migrate` → `ExitCode=1 FinishedAt=2026-08-15T10:29:16Z`。`docker logs` に上記 traceback。`stat` → 全ファイル mode 644 / uid 1000 / ctime 2026-09-13（一括変更）。`docker exec wmcdss-backend id` → uid=999(appuser)。`migrate status/up` をコンテナ uid 999 で実行 → EXIT=0 |
| **F-5** | **Medium** | **デモ観測データが 45 日間 stale で、全 6 現場が `caution` に固定され `go` 判定が一切出ない。** 観測の最新が `2026-08-15 20:08:46+09`（検証時点で 45 日 3 時間前）。アプリの鮮度ガード（weather 60 分 / marine 3 時間）により欠測扱いとなり、`GET /api/v1/dashboard` が全現場 caution を返す。DB の整合性問題ではなくデータ鮮度の問題だが、**MVP のデモ機能（go/caution/stop の 3 状態表示）が実質的に成立していない**。 | `select max(observed_at)` → 2026-08-15 20:08:46（age 45 days 03:14）。`GET /api/v1/dashboard` → `status 分布: {caution: 6}`、reason「観測値が取得できないため評価できないしきい値があります」 |
| **F-6** | **Low** | **backup/restore スクリプトが本環境で実行不能。** `.env` / `.env.production` が存在しないため `docker compose --env-file …` が即失敗。さらに稼働スタックは project `wmcdss-verify` として `/tmp` の patched compose から起動されており、リポジトリ compose 経由の `compose exec db` は `service "db" is not running` で対象を掴めない。→ 運用 Runbook のコマンドがそのままでは動かない。 | `backup.sh --compose dev` → EXIT=1 / `couldn't find env file: …/.env`。`docker compose -f docker-compose.yml exec -T db pg_isready` → EXIT=1 / `service "db" is not running`。`docker inspect` labels → `com.docker.compose.project=wmcdss-verify`, config_files=`/tmp/wmcdss-verify/docker-compose.patched.yml` |
| **F-7** | **Low** | **down migration が存在しない。** 設計判断として `docs/TECHNICAL.md` に明記されており妥当だが、結果として**復旧手段が pg_dump からのリストア 1 本**になる。F-1/F-2 と組み合わさると「戻せない」状態を作りやすい。 | `migrate.py` の `choices=("up","status","baseline")`。`db/migrations/` に down なし。`docs/TECHNICAL.md` §rollback |
| **F-8** | **Low** | **`thresholds` に業務キーの UNIQUE 制約が無い。** `(site_id, work_type, metric, op, severity)` 等の一意性が DB で保証されず、`idx_thresholds_lookup` も非 UNIQUE。API（`POST /api/v1/thresholds`）からは同一ルールを無制限に重複登録でき、判定結果の重複・運用混乱につながる。現データに重複は 0 件。 | `pg_constraint` に thresholds の UNIQUE は pkey のみ。重複チェック実測 0 件。`thresholds.py` の create に重複検査なし |
| **F-9** | **Info** | **API 検証による `audit_log` の増加（56→60）を意図的に残置。** 4 行は `site.create` / `threshold.create` / `threshold.update` / `threshold.delete` で、`write_audit(..., strict=True)` が正規に記録したもの。監査証跡は追記専用であるため削除していない。タスクの完了条件（sites / thresholds の行数一致）は満たしている。なお `audit_log.target_id` には FK が無く、参照先が消えても監査行は残る設計（妥当だが参照整合性はアプリ責務）。 | `select id,action,target_id,occurred_at from audit_log where …` → id 57〜60 |
| **F-10** | **Info** | **ドキュメント参照切れ。** `docs/DEPLOYMENT-OPTIONS-2026-08-12.md` は「バックアップ/リストア | docs/backup-restore.md に実装済み」と参照するが、当該ファイルは存在しない（実体は `docs/OPERATIONS-2026-08-12.md` §4 と `docs/IT-STAFF.md`）。 | `ls docs/backup-restore.md` → No such file or directory |
| **F-11** | **Info** | `users` / `etl_runs` / `forecasts` は 0 行。ローカル認証は環境変数（`WMCDSS_LOCAL_USERS`）ベースで `users` テーブルを使っていない（認可設計は backend-sec の担当範囲であり本検証では深追いしない）。`forecasts` テーブルはスキーマのみで未使用、`etl_runs` も未記録。 | 各 `count(*)` = 0。`forecasts` の pkey 以外の唯一の索引は未使用 |

---

## 4. 未実施項目と理由

| 項目 | 状態 | 理由 |
|---|---|---|
| `scripts/wmcdss-db-backup.sh` **本体**によるバックアップ取得 | **未実施** | F-6: `.env` / `.env.production` が存在せず `docker compose --env-file` が失敗。稼働スタックは project `wmcdss-verify`（`/tmp` の patched compose）で起動されておりリポジトリ compose の `exec db` が対象を掴めない。→ 代わりに**スクリプトと同一のコマンド列**（`pg_dump --clean --if-exists \| gzip` / `gunzip -c \| psql -v ON_ERROR_STOP=1`）で往復検証を実施し、成功を確認した |
| `scripts/wmcdss-db-restore.sh` **本体**によるリストア | **未実施** | 同上（対象バックアップも不在）。代替として**等価コマンドでスクラッチ DB `wmcdss_restore_check` への往復を実施**し、行数・checksum・制約・索引・トリガ・シーケンスの完全一致を確認した |
| 本番 `wmcdss` DB へのリストア | **未実施（意図的）** | 破壊的操作でありタスクの制約で禁止。復元先は必ず `_restore_check` を付けたスクラッチ DB とし、終了後に自分で drop した |
| DROP / TRUNCATE / 大量 DELETE による破壊的検証 | **未実施（意図的）** | タスクの制約で禁止。制約検証はすべて `BEGIN` → `ROLLBACK`（COMMIT なし）の非破壊 probe で代替した |
| ロールバックの実地テスト（スキーマを戻す） | **未実施（意図的）** | 本番 DB を戻す破壊的操作が必要で、かつ down migration が存在しない。能力評価のみ実施 |
| `docker-compose.production.yml` での本番パス検証 | **未実施** | 本番スタックはこのホストに存在しない（`.env.production` も無い）。dev スタックのみ検証 |
| 負荷・同時実行テスト（advisory lock の実競合） | **未実施** | 目的（スキーマ検証）に対して過剰。`migrate.py` の advisory lock 実装はコード読解のみ（`pg_advisory_lock(5271070116)`） |
| backend の認可挙動（匿名 admin 昇格）の検証 | **未実施（担当外）** | backend-sec が並行して修正中であり、書き込み範囲が競合するため深追いしない。本検証は正当な admin JWT 経路のみを検証した |

---

## 5. 推奨 Next Action

優先度順。

1. **[F-1 / High] バックアップの自動取得を今すぐ有効化する。** まず 1 回手動で有効なバックアップを取得し、cron または systemd timer（`30 3 * * *` 推奨）を登録する。`docs/OPERATIONS-2026-08-12.md` §1 の RPO 24h / 30 世代を満たすには、取得・世代管理・外部退避（scp/rclone）まで通した状態が必要。登録後は `scripts/wmcdss-healthcheck.sh` が EXIT=0 になることを確認する。
2. **[F-2 / High] バックアップの「内容」を検証してから成功扱いにする。** 具体的には (a) 一時ファイルへ出力して `pg_dump` の終了コードとサイズ（下限しきい値、例 1 KB 以上）を確認してから最終名へ rename する、(b) `wmcdss-healthcheck.sh` にサイズ下限と `gzip -dc | head -c 1` 等の非空確認を追加する、(c) `restore.sh` に「復元前後の `sites` 件数比較」または「空ストリーム検出時は非ゼロ終了」を追加する。空 gzip は `gzip -t` を通過するため、`gzip -t` だけでは不十分。
3. **[F-3 / Medium] `wmcdss` ロールの権限を最小化する。** 本番（`POSTGRES_USER=wmcdss_app` も同じ構図）では、ブートストラップ用スーパーユーザーとは別に、`NOSUPERUSER NOCREATEDB NOCREATEROLE` のアプリ用ロールを作成し、業務テーブルの DML のみを GRANT する。マイグレーション適用時のみ高権限ロールを使う分離（別ロール or 別接続）を検討する。あわせて `pg_hba.conf` の loopback `trust` を見直し、`scram-sha-256`（または `peer`）へ変更する。
4. **[F-4 / Medium] migration マウントの権限を運用ルール化する。** 「`db/migrations/*.sql` は 0644 以上（コンテナ実行ユーザー uid 999 から読めること）」を pre-deploy チェックに含める。再現手順として、`db-migrate` が EXIT=1 のまま残っていないか（`docker inspect <container> --format '{{.State.ExitCode}}'`）をデプロイ前に確認する手順を Runbook に追加する。
5. **[F-5 / Medium] デモデータを更新する仕組みを用意する。** 観測値の鮮度ガードが正しく効いている結果であり DB の欠陥ではないが、デモが `caution` 固定では機能証明にならない。`0006_*.sql` として `now()` 基準で再生成する migration を追加する（既存 0004/0005 を書き換えると checksum drift で `migrate up` が停止するため、**必ず新番号のファイルを追加**すること）。恒久対策は ETL の定期実行。
6. **[F-6 / Low] 運用スクリプトを環境非依存にする。** `.env` 不在時のフォールバック（`--db-user/--db-name` の既定値を使い `--env-file` を省略する）、または `--project` / `--compose-file` を明示指定できるオプションを追加する。現状は「動いているスタックなのに Runbook のコマンドが動かない」状態。
7. **[F-8 / Low] `thresholds` の一意性を DB で保証する。** 新規 migration で `CREATE UNIQUE INDEX ... ON thresholds (site_id, work_type, metric, op, severity)`（NULL を考慮し `COALESCE(site_id, '00000000-...')` を用いる等）を追加し、API 側でも 409 を返す。
8. **[F-10 / Low] ドキュメントの参照切れを修正する**（`docs/backup-restore.md` → `docs/OPERATIONS-2026-08-12.md` §4 へのリンク）。
9. **[F-9 / Info] `audit_log` の増分 +4 を認識しておく。** 追記専用の正規記録であり、削除は推奨しない。集計値を厳密に突き合わせる場合は本エビデンスの値を基準にすること。

---

## 付録: 主要な実行コマンド一覧（再現用）

```bash
# 1. 接続・権限
docker exec wmcdss-db psql -U wmcdss -d wmcdss -X -c "select version();"
docker exec wmcdss-db psql -U wmcdss -d wmcdss -X -c "\du"
docker exec wmcdss-db psql -U wmcdss -d wmcdss -X -A -F'|' -c \
  "select rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls from pg_roles;"

# 2. スキーマ
docker exec wmcdss-db psql -U wmcdss -d wmcdss -X -A -F'|' -c \
  "select table_name,ordinal_position,column_name,data_type,is_nullable,column_default
   from information_schema.columns where table_schema='public' order by 1,2;"

# 3. migration（checksum 検証・drift 検出）
PYTHONPATH=backend WMCDSS_DATABASE_URL='postgresql+asyncpg://wmcdss:wmcdss@127.0.0.1:5434/wmcdss' \
  WMCDSS_MIGRATIONS_DIR="$PWD/db/migrations" python3 -m app.db.migrate status
docker exec -e WMCDSS_MIGRATIONS_DIR=/tmp/dbver_migrations wmcdss-backend python -m app.db.migrate up

# 4. 制約
docker exec wmcdss-db psql -U wmcdss -d wmcdss -X -A -F'|' -c \
  "select c.conrelid::regclass, c.conname, c.contype, pg_get_constraintdef(c.oid)
   from pg_constraint c join pg_namespace n on n.oid=c.connamespace
   where n.nspname='public' order by 1,3,2;"

# 5. インデックス
docker exec wmcdss-db psql -U wmcdss -d wmcdss -X -A -F'|' -c \
  "select c.relname, i.relname, pg_get_indexdef(x.indexrelid)
   from pg_index x join pg_class c on c.oid=x.indrelid join pg_class i on i.oid=x.indexrelid
   join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by 1,2;"

# 6. トランザクション原子性（BEGIN → INSERT → カウント → ROLLBACK）
docker exec -i wmcdss-db psql -U wmcdss -d wmcdss -X <<'SQL'
BEGIN;
INSERT INTO sites (code,name,kind,lat,lon,note) VALUES ('verify-probe-tx','検証用','land',35,139,'probe');
SELECT count(*) FROM sites;   -- 7
ROLLBACK;
SELECT count(*) FROM sites;   -- 6
SQL

# 7. API（JWT はコンテナ内生成。値は出力しない）
TOKEN=$(docker exec wmcdss-backend python -c \
  "from app.core.auth import create_access_token; print(create_access_token(subject='verify', auth_type='local', role='admin'))")
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:18003/api/v1/sites

# 8. バックアップ往復（スクラッチ DB。本番 DB へは流さない）
docker exec wmcdss-db pg_dump --clean --if-exists -U wmcdss wmcdss | gzip > /tmp/wmcdss_check.sql.gz
gzip -t /tmp/wmcdss_check.sql.gz
docker exec wmcdss-db createdb -U wmcdss wmcdss_restore_check
gunzip -c /tmp/wmcdss_check.sql.gz | docker exec -i wmcdss-db psql -v ON_ERROR_STOP=1 -U wmcdss -d wmcdss_restore_check
#   ← 行数・checksum・制約・索引・トリガ・シーケンスを比較
docker exec wmcdss-db dropdb -U wmcdss wmcdss_restore_check
rm -f /tmp/wmcdss_check.sql.gz

# 9. rollback 手段の有無
grep -n 'choices=(' backend/app/db/migrate.py       # → ("up","status","baseline") のみ
ls db/migrations/                                    # → forward-only の 5 ファイル
```

---

*本ドキュメントは task-3 の成果物です。検証は非破壊で行い、作成した検証用オブジェクト（sites/thresholds の `verify-*` 行、スクラッチ DB `wmcdss_restore_check`、`/tmp` の一時ファイル、コンテナ内 `/tmp/dbver_migrations`、失敗時に残った空バックアップ）はすべて後始末済みです。*
