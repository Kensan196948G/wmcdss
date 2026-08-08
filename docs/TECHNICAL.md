# 🛠️ WMCDSS 技術リファレンス

> このドキュメントは **開発者・運用担当者向け** の技術詳細をまとめたものです。
> プロダクトの概要・使い方・収集データについては [`README.md`](../README.md) を参照してください。

[![tests](https://img.shields.io/badge/tests-640%20unit%20%2B%205%20E2E%20%2B%209%20smoke-brightgreen)](#-テスト)
[![frontend coverage](https://img.shields.io/badge/frontend%20coverage-99.27%25-brightgreen)](#-frontend-coverage-matrix)
[![backend coverage](https://img.shields.io/badge/backend%20coverage-99%25-brightgreen)](#-テスト)
[![ci](https://img.shields.io/badge/CI-ruff%20%2B%20pytest%20%2B%20vitest%20%2B%20vite%20%2B%20docker-2088FF)](../.github/workflows/ci.yml)
[![python](https://img.shields.io/badge/python-3.11%2B-blue)]()
[![fastapi](https://img.shields.io/badge/FastAPI-0.115%2B-009688)]()
[![postgres](https://img.shields.io/badge/Postgres-16-336791)]()

---

## 🏗️ 構成（ハイレベル）

```mermaid
flowchart LR
  subgraph JMA[気象庁公開エンドポイント]
    A1[AMeDAS 10分観測]
    A2[波浪ナウキャスト]
  end

  subgraph Host[サーバホスト]
    T1[systemd timer<br/>AMeDAS :0/10 min]
    T2[systemd timer<br/>wave :03 hourly]
    subgraph DC[docker compose]
      N[nginx<br/>frontend<br/>静的配信＋/api/ reverse proxy]
      B[FastAPI<br/>backend]
      D[(Postgres 16)]
    end
  end

  subgraph Client[ブラウザ]
    F[React 18 + Vite 6<br/>SPA]
  end

  A1 --> T1
  A2 --> T2
  T1 -->|ingest_jma| B
  T2 -->|ingest_jma_marine| B
  B --> D
  F -->|HTTP /| N
  N -->|/api/ proxy| B
  B -->|JSON| N
  N -->|static + JSON| F

  classDef ext fill:#fff3cd,stroke:#856404
  classDef svc fill:#d4edda,stroke:#155724
  classDef cli fill:#cce5ff,stroke:#004085
  class A1,A2 ext
  class N,B,D,T svc
  class F cli
```

詳細は [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) を参照。

---

## 🧩 主要コンポーネント

| レイヤ             | 技術                                                                                                                                                                                      | パス                                                              | 役割                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 🖥️ Frontend        | React 18 + Vite 6 + TypeScript（**全 15 ページ ESM port 完了 ＋ density/dark/role 永続化 ＋ Babel Standalone 完全退役 Loop 44**）                                                         | `frontend/vite-app/`（唯一の entry, nginx multi-stage 配信）      | ダッシュボード・現場/閾値管理画面（**全国マップ 40件・エリアフィルター・横並びアラートバナー** ＋ mock 警告帯 ＋ localStorage 永続化） |
| 🌐 Frontend エッジ | nginx 1.27-alpine（multi-stage Docker build, lazy DNS）                                                                                                                                   | `frontend/vite-app/Dockerfile`<br/>`frontend/vite-app/nginx.conf` | Vite 静的配信 ＋ `/api/` reverse proxy ＋ `/readyz` passthrough                             |
| 🐍 Backend API     | FastAPI + SQLAlchemy 2.0 async（**Loop 46: docker healthcheck で `/readyz` を judge — `compose up --wait` が DB 接続成立まで待つようになり frontend は `service_healthy` 依存に格上げ**） | `backend/app/`                                                    | 観測値・閾値・判定 REST API                                                                 |
| 🗄️ DB              | PostgreSQL 16                                                                                                                                                                             | `db/migrations/`                                                  | 観測値・現場・閾値・監査ログ                                                                |
| ⏱️ Ingester        | httpx + systemd timer                                                                                                                                                                     | `backend/app/jobs/ingest_jma{,_marine}.py`<br/>`deploy/systemd/`  | AMeDAS（10 分毎）／wave nowcast（毎時）の 2 系統並走                                        |
| 🔐 Auth            | API Key middleware                                                                                                                                                                        | `backend/app/core/security.py`                                    | mutation エンドポイントを保護                                                               |
| 🚦 Rate Limit      | Sliding window middleware                                                                                                                                                                 | `backend/app/core/ratelimit.py`                                   | identity 単位 (key hash / IP) の濫用防御                                                    |
| 📊 Monitoring      | prometheus_client 0.21+                                                                                                                                                                   | `backend/app/core/monitoring.py`<br/>`backend/app/api/metrics.py` | Prometheus 形式 `/metrics` エンドポイント — リクエスト数・レイテンシヒストグラム（Loop 50） |
| 📜 Audit           | Service-level audit writes                                                                                                                                                                | `backend/app/services/audit.py`                                   | 変更の actor/detail を永続化                                                                |

---

## 🗾 全国現場マップ（フロントエンド）

ダッシュボードの現場マップを **東京湾岸エリア 6件 → 全国 40件** に拡張。

| 項目 | 内容 |
| ---- | ---- |
| 対応エリア | 北海道 / 東北 / 関東 / 中部 / 近畿 / 中国 / 四国 / 九州 / 沖縄（9エリア） |
| 初期表示 | 日本全土（中心 36.0°N, 137.0°E / zoom 5） |
| エリアフィルター | カードヘッダーのボタン1クリックで対象エリアへ自動ズームイン |
| アラートバナー | 「中止推奨」「注意」をそれぞれ最大5件を**横並びチップ**で表示、超過分は `+N件` バッジ |
| モックデータ | `data.ts` の `SITES` 配列 40件（`area` フィールドでエリア分類）、`WEATHER_TABLE` / `MARINE_TABLE` 全件対応 |

```
⚠  中止推奨  [千葉港浚渫] [秋田沖風力] [富山港防波堤] [下関関門航路]
⚡  注意      [横浜港防波堤] [木更津風力] [茨城沖風力] [函館港埠頭] [仙台港埠頭]  +6件
```

---

## 🔌 API エンドポイント一覧

| Method                | Path                                   | 認証    | 用途                                                               |
| --------------------- | -------------------------------------- | ------- | ------------------------------------------------------------------ |
| `GET`                 | `/healthz` `/readyz`                   | 不要    | プロセス/DB liveness                                               |
| `GET`                 | `/metrics`                             | 不要    | Prometheus スクレープエンドポイント（`text/plain; version=0.0.4`） |
| `GET`                 | `/api/v1/sites`                        | 不要    | 現場一覧                                                           |
| `POST`                | `/api/v1/sites`                        | 🔐 必要 | 現場登録（`audit_log` に記録）                                     |
| `POST`                | `/api/v1/decisions`                    | 🔐 必要 | 期間内観測値から判定を計算（`audit_log` に記録）                   |
| `GET`                 | `/api/v1/thresholds`                   | 不要    | site/work_type ごとの閾値（OR-merge）                              |
| `POST` `PUT` `DELETE` | `/api/v1/thresholds`                   | 🔐 必要 | 閾値 CRUD                                                          |
| `POST`                | `/api/v1/observations/weather`         | 🔐 必要 | AMeDAS 観測値の upsert（バッチ）                                   |
| `GET`                 | `/api/v1/observations/weather`         | 不要    | 期間内観測値                                                       |
| `GET`                 | `/api/v1/observations/weather/latest`  | 不要    | 最新観測値                                                         |
| `POST`                | `/api/v1/observations/marine`          | 🔐 必要 | 波浪観測値の upsert                                                |
| `GET`                 | `/api/v1/observations/marine[/latest]` | 不要    | 海象観測値                                                         |
| `GET`                 | `/api/v1/audit`                        | 不要    | 監査ログ                                                           |

🔐 = `X-API-Key` ヘッダ必須（`WMCDSS_API_KEYS` 環境変数で設定）

---

## 🗄️ データモデル（収集データの格納先）

### `weather_observations`（AMeDAS 気象観測値）

| カラム | 型 | 内容 |
| --- | --- | --- |
| `temperature_c` | float | 気温（℃） |
| `humidity_pct` | float | 湿度（%） |
| `pressure_hpa` | float | 気圧（hPa） |
| `precip_mm` | float | 降水量（mm） |
| `wind_speed_ms` | float | 風速（m/s） |
| `wind_gust_ms` | float | 最大瞬間風速（m/s） |
| `wind_dir_deg` | float | 風向（度） |
| `sunshine_h` | float | 日照時間（h） |
| `observed_at` | timestamptz | 観測時刻 |
| `fetched_at` | timestamptz | 取得時刻 |
| `source` | string | 取得元（既定 `jma`） |

### `marine_observations`（波浪ナウキャスト海象観測値）

| カラム | 型 | 内容 |
| --- | --- | --- |
| `sig_wave_h_m` | float | 有義波高（m） |
| `wave_period_s` | float | 波周期（s） |
| `wave_dir_deg` | float | 波向（度） |
| `tide_level_m` | float | 潮位（m） |
| `current_speed_ms` | float | 流速（m/s） |
| `current_dir_deg` | float | 流向（度） |
| `observed_at` | timestamptz | 観測時刻 |
| `fetched_at` | timestamptz | 取得時刻 |
| `source` | string | 取得元（既定 `jma_wave`） |

### `sites`（現場マスタ）

`code` / `name` / `kind`（land / marine / both）／ `lat` / `lon` / `jma_station_id` / `wave_grid_lat` / `wave_grid_lon` / `address` / `note`

### `thresholds`（判定閾値）

`site_id` / `work_type` / `metric` / `op` / `value` / `severity`（warn / stop）／ `active_from` / `active_to`

#### 有効期間（`active_from` / `active_to`）の意味論

季節基準（例: 冬季だけ厳しい風速基準）を切り替えるための `date` 列。判定時の
扱いは以下のとおり（`app/services/decision.py::is_rule_in_effect`）。

| 規則 | 内容 |
| --- | --- |
| **NULL = 無期限** | `active_from` が NULL なら過去方向、`active_to` が NULL なら未来方向に無制限。両方 NULL のルールは常に有効 |
| **両端 inclusive** | `active_to = 2026-03-31` のルールは 3/31 当日も発火する（"to" は "until" ではない） |
| **比較対象は「今日」ではない** | 判定リクエストの `target_window_start` 〜 `target_window_end` と突き合わせる。本 API は将来の施工計画も判定するため、`datetime.now()` で絞ると来月の計画を今月の基準で判定してしまう |
| **重なりで判定** | 施工時間帯が有効期間の境界を跨ぐ場合、一部でも重なればルールを適用する（境界日で安全側のしきい値が消えないようにするため） |
| **JST 暦日で比較** | `active_from` / `active_to` は現場担当者が日本の暦日として入力する。施工時間帯は timestamptz なので JST へ変換してから日付に落とす。UTC のまま比較すると JST 00:00〜09:00 の時間帯が前日扱いになり、有効期間の初日・最終日で 1 日ずれる |
| **naive datetime = UTC** | `target_window_start` / `target_window_end` に timezone 指定が無い場合は UTC とみなす（`app/services/decision.py::as_utc`）。正規化は API 境界で 1 回だけ行い、以降の判定・永続化・監査ログはすべて正規化後の値を使う。**JST 解釈ではない**ため `2026-03-31T16:00:00`（オフセット無し）は JST 4/1 として扱われ、3/31 までのルールは失効する |

> 施工時間帯は timezone 付き（`2026-03-31T16:00:00Z` や `+09:00`）で送ることを推奨する。
> オフセットを省略した場合の UTC 解釈は互換のための既定であり、意図した暦日と
> ずれる余地がある。

有効期間外として判定から外したルールは捨てず、`decisions.thresholds_snapshot`
の `out_of_effect` と `audit_log.detail.out_of_effect_rules` に残す。これが無いと
「しきい値が未設定」と「設定はあるが期間外」が監査上まったく同じ
`{"rules": []}` になり、有効期間の設定ミスを事後に追跡できない。判定理由文も
両者で別の案内を出す（前者「しきい値を設定してください」／後者「有効期間を
確認してください」）。

`db/migrations/0002_seed_demo.sql` の INSERT は両列を指定しないため、既定
データ 11 行はすべて NULL＝無期限であり、この機能の導入で既存の判定結果は
変わらない。

### `audit_log`（監査ログ）

`occurred_at` / `actor` / `action` / `target_type` / `target_id` / `detail`（JSONB）

---

## 🧱 DB migration（スキーマ適用）

`db/migrations/*.sql` の適用経路は **`backend/app/db/migrate.py` のランナー 1 本だけ**。
compose では `db-migrate` サービス（ワンショット）として定義され、`backend` と
ingest 系は `depends_on: { db-migrate: { condition: service_completed_successfully } }`
で待つ。migration が失敗すれば API は起動しない。

### なぜ `/docker-entrypoint-initdb.d` を使わないか

postgres 公式 entrypoint は `$PGDATA/PG_VERSION` が存在すると初期化処理を
**丸ごと飛ばす**（ログに `Skipping initialization` と出る）。つまり
`/docker-entrypoint-initdb.d` へのマウントは **DB ボリュームを作った最初の 1 回
しか実行されない**。0003 以降を追加しても既存環境には二度と届かず、
「デプロイは成功したのにスキーマだけ古い」状態が静かに成立する。
この構造欠陥を塞ぐため、initdb マウントは dev / production 双方から撤去した。

### コマンド

いずれも `python -m app.db.migrate <command>`。ディレクトリは
`WMCDSS_MIGRATIONS_DIR`（既定 `/migrations`）、`--dir` で上書き可。

| コマンド | 動作 | 終了コード |
| --- | --- | --- |
| `up`（既定） | 未適用を番号順に適用。**1 ファイル = 1 トランザクション** | 0 = 適用完了 or 適用対象なし |
| `status` | 何も適用せず件数と異常だけ報告 | 0 = 健全 / 1 = 要 baseline または改竄検出 |
| `baseline` | 既存 DB の現状を「全て適用済み」と**記録だけ**する（SQL は実行しない） | 0 = 記録成功 / 1 = 誤用 |

```bash
# 開発（compose が自動実行するので通常は不要。手動確認したいとき）
docker compose run --rm db-migrate python -m app.db.migrate status

# 本番
docker compose --env-file .env.production -f docker-compose.production.yml \
  run --rm db-migrate python -m app.db.migrate status
```

### 安全側の作り

| 仕組み | 目的 |
| --- | --- |
| **checksum 照合** | 適用済みファイルが書き換えられたら停止（exit 1）。DB には旧版、ファイルは新版という「どの版が当たっているか誰も分からない」状態を作らせない。**再適用はしない** — 既に当たっている DDL を再実行すれば `relation already exists` で落ちるだけで、正しい対処は停止 |
| **`pg_advisory_lock`** | 同時デプロイで 2 本走っても 2 本目は待つ。ロックはセッション単位で、`finally` で必ず解放 |
| **1 ファイル 1 トランザクション** | 途中で失敗しても半端な DDL が残らない |
| **番号順（数値）ソート** | `10_` は `2_` より後。辞書順ではない |
| **規則外ファイルで停止** | `hotfix.sql` のように番号が無い `.sql`、番号重複を検出したら適用せず exit 1。「置いたのに適用されない」が一番気付きにくい |
| **ディレクトリ空 / 不在で停止** | マウント忘れ・パス打ち間違いを「適用対象 0 件で成功」にしない。Docker はホスト側パスを打ち間違えると**空ディレクトリを作って**マウントするため、両方を弾く |
| **`schema_migrations` 記録** | `version` / `checksum` / `applied_at` / `applied_by` を保存。監査に耐える |

### 新しい migration を足す

1. `db/migrations/0003_<説明>.sql` を作る（`<数字>_<名前>.sql`、番号は連番）。
2. **適用済みファイルは絶対に書き換えない**。変更は必ず新しい番号のファイルで行う。
3. additive・後方互換のみ（`ADD COLUMN` / `CREATE INDEX` / `CREATE TABLE`）。
   破壊的変更は expand-and-contract に分解し、Approval PR へ分離する。
4. `docker compose up -d` すれば `db-migrate` が適用してから backend が起動する。

### 既存 DB の baseline（ランナー導入前から動いている環境のみ・一度きり）

このランナーを入れる前に initdb 経路で作られた DB は、**スキーマはあるのに
`schema_migrations` が空**になる。どのファイルが適用済みかは DB からは判定
できないため、ランナーは自動では進めず次を出して停止する（exit 1）。

```
DB にスキーマが存在するのに migration の適用記録が無い。
...
一度だけ次を実行すること:
    python -m app.db.migrate baseline
```

この状態では `backend` は起動しない（`service_completed_successfully` で待つため）。
**現在の migration ファイル群が全て適用済みであることを確認してから**、一度だけ：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  run --rm db-migrate python -m app.db.migrate baseline
# → baseline: 0001_init.sql を適用済みとして記録（SQL は実行していない）
# → baseline: 0002_seed_demo.sql を適用済みとして記録（SQL は実行していない）

# 記録後は通常どおり起動する
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

`baseline` は誤用を両側で拒否する — 記録が 1 件でもあれば実行しない（二重
baseline 防止）、スキーマが無ければ「`up` を実行すること」と案内して実行しない
（新規 DB を空のまま「適用済み」と誤記録する事故の防止）。

### rollback

**down migration は用意していない。** SQL の逆操作を自動生成すると、
`DROP COLUMN` が復元不能なデータ損失になる経路を常時抱えることになるため。
スキーマを戻す必要が出た場合の手順は次のとおり。

1. `docker compose ... stop backend weather-ingest marine-ingest`（書き込みを止める）
2. 事前バックアップから復元（→ [`IT-STAFF.md` 💾 バックアップ](./IT-STAFF.md)）。
   `schema_migrations` もダンプに含まれるため、復元時点の適用記録ごと戻る。
3. アプリのイメージも同じ時点の commit へ戻してから起動する。

つまり **migration を伴うデプロイの前には必ず `pg_dump` を取る**。これが唯一の
復旧地点になる。

---

## 🚀 ローカル起動（5 分）

```bash
# 1. リポジトリ取得
git clone https://github.com/Kensan196948G/wmcdss.git && cd wmcdss

# 2. 起動（DB + backend）
docker compose up -d

# 3. ヘルスチェック
curl -s http://localhost:8003/healthz
#  → {"status":"ok"}

# 4. ブラウザ
open http://localhost:8080/   # docker compose の nginx service (frontend/vite-app)
#                              # window.WMCDSS_API_BASE は同ホスト :8003 自動推定
```

### 🆕 Vite ビルド（**全ページ ESM port 完了 ＋ Docker 配信 hardened ＋ Babel Standalone 完全退役**）

`frontend/vite-app/` は **Phase 1（15 ページ ESM port）→ Phase 2 入口（Loop 26 で本番 entry 化）→ TweaksPanel/role/density/dark/persistence 配線（Loop 29-34）→ docker-compose 配下に nginx service 化（Loop 36）→ Dockerfile build context-escape ＋ nginx eager DNS の 2 件 latent bug を解消（Loop 38）→ Babel Standalone 系統（`frontend/index.html` ＋ 11 `.jsx` ファイル計 3,190 行）を完全退役（Loop 44）**まで前進。

- ✅ `src/api.ts` — `../api.jsx` の ESM/TS 版（named exports ＋ `window.WMCDSS_API` 副作用維持）
- ✅ `src/app-shell.tsx` — root sidebar + header + 15-page router（`PageId` 15-member literal union ＋ exhaustive `Record<PageId, string>`）＋ density / role / dark mode 配線（Loop 30）
- ✅ `src/{dashboard,decisions,weather-marine,analysis,site-pages,admin-pages,concrete-marine-work,charts,data}.tsx` — 全 15 ページ ESM port 完
- ✅ `src/main.tsx` — `WMCDSS_API.initFromBackend()` を `.finally(render)` chain で先行実行 ＋ inline `<MockBanner />` で `window.BACKEND_STATUS?.ok` 未接続時に「施工判断には使用しないでください」赤帯表示／成功時は live sites 数を緑帯表示（Loop 33、Loop 44 で唯一の entry point に昇格）
- ✅ `src/tweaks-panel.tsx` — Loop 29 で ESM port 完了、Loop 32 で `localStorage` 永続化、Loop 34 で `.density-compact` を header/sidebar に拡張
- ✅ `src/styles.css` — Loop 31 で `import './styles.css'` 経由に正規化、Loop 38 で `vite-app/src/` 配下に移設して Docker build context 内に閉じ込め
- ✅ `Dockerfile`（multi-stage `node:22-alpine` build → `nginx:1.27-alpine` runtime）／ `nginx.conf`（`resolver 127.0.0.11 valid=10s` ＋ `set $backend_upstream ...` で **lazy DNS**、compose 外 standalone 起動でも nginx が clean に立ち上がる）
- ✅ `.github/workflows/ci.yml` の `frontend / docker image build` job — host `npm run build` の green では検出不能な context-escape / eager DNS を機械検出（Loop 38）

```bash
cd frontend/vite-app
npm ci                          # Vite 6 + React 18 + TS（lockfile-pinned, CI と同手順）
npm run dev                     # HMR dev server → http://localhost:5173
npm run build                   # → dist/   (Loop 38 時点: 37 modules, CSS gzip 2.86 kB / JS gzip 74.27 kB)
docker build -t wmcdss-frontend .   # multi-stage build — CI と同等 image
```

> 🛡️ **safety parity**: バックエンド未接続時は赤帯 `<div role="alert">` が render される構造ガード (`main.tsx:MockBanner`)。`initFromBackend()` reject 経路でも `.finally(render)` で必ず render し、「白画面 + ユーザが mock を実データと誤認」事故を構造遮断。

### 環境変数（主なもの）

| 変数                           | 既定                                                       | 用途                                                                                     |
| ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `WMCDSS_DATABASE_URL`          | `postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss` | DB 接続                                                                                  |
| `WMCDSS_MIGRATIONS_DIR`        | `/migrations`                                              | migration ランナーが読む SQL ディレクトリ（compose が read-only で bind mount）           |
| `WMCDSS_API_KEYS`              | （空＝認証無効）                                           | カンマ区切りの API キー一覧                                                              |
| `WMCDSS_CORS_ORIGINS`          | 192.168.0.185:8888 等                                      | CORS 許可元                                                                              |
| `WMCDSS_JMA_USER_AGENT`        | `wmcdss/0.1 (+contact: …)`                                 | JMA への User-Agent                                                                      |
| `WMCDSS_RATE_LIMIT_PER_MINUTE` | `0`（無効）                                                | mutation の identity 単位 60-秒 sliding window cap                                       |
| `WMCDSS_EXPOSE_OPENAPI`        | `true`（dev）                                              | `false` で `/openapi.json`・`/docs`・`/redoc` を 404 に — 本番でスキーマを匿名公開しない |

---

## ⏱️ JMA 自動取得（systemd timer）

```bash
cp deploy/systemd/wmcdss-jma-fetch.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
loginctl enable-linger "$USER"
```

`OnCalendar=*:0/10:30` で AMeDAS の 10 分粒度ティックを取得。`Persistent=true` で
停止中の取りこぼしも次回起動時に自動補正。詳細 → [`deploy/systemd/README.md`](../deploy/systemd/README.md)

---

## 🧪 テスト

```bash
docker compose exec backend pytest -q tests/
```

| グループ                                           |    件数 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ユニット（auth middleware）                        |      28 | API Key 認証・exempt パス・タイミング攻撃耐性・非 ASCII 鍵拒否・過大鍵 DoS 防御・header 多重指定・空 keys 設定の閉鎖（Loop 37 で 9 → 23 へ拡張）／**境界値 + パス prefix 5 件（Loop 48 — 空白パディング鍵拒否・512 境界包含・サブパス exempt・隣接パス漏洩防止）**                                                                                                                                                                                                                                                         |
| ユニット（rate limit middleware）                  |      17 | sliding window・bucket 分離・window 期限切れ復活・exempt パス・identity hashing 漏洩防止／**FIFO identity eviction 3 件（Loop 41）**／**境界値 4 件（Loop 48 — client=None identity・window 境界厳密一致・PUT/PATCH/DELETE rate-limit・最終許可リクエストの remaining=0）**                                                                                                                                                                                                                                                |
| ユニット（audit hardening）                        |       9 | actor_from の API Key 漏洩防止・write_audit strict モードの SQLAlchemyError 伝播                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ユニット（JMA AMeDAS fetcher）                     |      16 | パース・品質フラグ・block ロールバック・QC-drop 検出／error-propagation 6 件（Loop 42）／**純粋関数 edge case 4 件 — `_val()` 非数値・`_wind_dir_deg()` non-list/TypeError・`_latest_entry()` non-dict — `jma.py:56-57/63/66-67/84` カバレッジ完全解消（Loop 55）**                                                                                                                                                                                                                                                        |
| ユニット（JMA wave fetcher）                       |      17 | パース・grid snap・日跨ぎ fallback・sentinel 値除外・scalar/tuple 両対応／error-propagation 5 件（Loop 43）／**純粋関数 edge case 3 件 — `_val()` 短リスト/非数値・`_latest_entry()` non-dict — `jma_wave.py:75/87-88/104` カバレッジ完全解消（Loop 55）**                                                                                                                                                                                                                                                                 |
| ユニット（decisions）                              |      37 | 判定ロジック・閾値マージ・境界値・OR-merge 優先度／**未評価時の fail-closed 契約 6 件（PR-D — 欠測・演算子不正・しきい値未設定では `go` にしない／`stop` は欠測で緩めない／欠測だけで `stop` へ上げない）**／**有効期間の意味論 14 件（R-1 — NULL＝無期限・両端 inclusive・境界跨ぎ・JST 暦日・全件期間外は「未設定」と別の理由文／`as_utc` の naive→UTC 付与・aware 不変・冪等・JST 境界での解釈固定）**（Loop 35 で 7 → 18、PR-D で 18 → 23、R-1 で 23 → 37）                                                                                              |
| ユニット（OpenAPI exposure policy）                |       4 | env スイッチで `/openapi.json`・`/docs`・`/redoc` を 404 化／無効でも `/healthz` ・`/` endpoints list は残る                                                                                                                                                                                                                                                                                                                                                                                                               |
| ユニット（health / readiness probes）              |       3 | `/healthz` は常時 200・`/readyz` は DB 健全時 200／DB 失敗時 **503**（Loop 45 — orchestrator contract pin: k8s/docker healthcheck/LB/`curl -sf` が HTTP status のみで readiness を判定するため、`{"status":"degraded"}` を 200 で返す silent failure を構造修正）                                                                                                                                                                                                                                                          |
| ユニット（Prometheus `/metrics`）                  |       6 | 200/content-type/auth 免除/rate-limit 免除/`wmcdss_http_requests_total` カウンター/`wmcdss_http_request_duration_seconds` ヒストグラム の存在を構造 pin — prometheus scraper は認証不要（Loop 50）                                                                                                                                                                                                                                                                                                                         |
| ユニット（observations API）                       |      13 | GET weather/marine list・latest 404/200・POST ingest empty/1-row — `_FakeResult` + `_FakeDB` duck-type で全 6 エンドポイントをカバー（Loop 51）                                                                                                                                                                                                                                                                                                                                                                            |
| ユニット（sites API）                              |       6 | GET list/404/200・POST 409 重複・POST 201 新規 — `_FakeDB.refresh()` で `id`/`created_at`/`updated_at` を注入（Loop 52）                                                                                                                                                                                                                                                                                                                                                                                                   |
| ユニット（thresholds API）                         |      10 | GET list（site_id/work_type フィルタ）・GET 404/200・POST 201・PATCH 404/200・DELETE 404/204（Loop 52）                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ユニット（decisions API）                          |      22 | POST 400 window 逆順/同一・go/caution/stop 判定・severity 優先度（挿入順両方）・go-not-met・レスポンス shape・marine stop・write_audit strict=True ロールバック（`_FlushFailDB` + `raise_server_exceptions=False`）／**しきい値未設定・観測値欠測での `caution` 降格と `thresholds_snapshot` の `unevaluated`／`evaluated` 保存（PR-D）**／**有効期間による除外 5 件（R-1 — 失効ルールは発火しない／同じ観測値でも期間内なら発火する＝`datetime.now()` 不使用の証明／全件期間外は `caution`／JSONB 直列化安全性／期間無指定は影響なし）**／**施工時間帯の timezone 正規化 5 件（R-1 — 片側 naive で 500 にならない×2／naive でも逆順は 400／永続化と監査ログの手前で aware 化されオフセット付きで記録される／JST 境界で naive が UTC 解釈される）**（Loop 53 + PR-D + R-1）                                    |
| ユニット（audit API）                              |      13 | GET empty/rows/actor/action/limit フィルタ・null actor・detail フィールド・limit>1000→422・t0/t1/target_type/target_id パラメータ受理・AuditOut 7 フィールド全確認（Loop 53）                                                                                                                                                                                                                                                                                                                                              |
| ユニット（weather ingest job）                     |      12 | `run_once()` 10 分岐（Loop 54）／**`main()` success+exception の sync テスト 2 件 — `asyncio.run` patch で `ingest_jma.py:156-165` カバレッジ解消（Loop 55）**                                                                                                                                                                                                                                                                                                                                                             |
| ユニット（marine ingest job）                      |      12 | `run_once()` 10 分岐（Loop 54）／**`main()` success+exception の sync テスト 2 件 — `ingest_jma_marine.py:172-181` カバレッジ解消（Loop 55）**                                                                                                                                                                                                                                                                                                                                                                             |
| ユニット（security `_key_matches` bytes ブランチ） |       1 | `bytes` 入力 → `AttributeError` → `return False` — `security.py:55-56` カバレッジ完全解消（Loop 54）                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ユニット（`get_db()` async generator）             |       1 | `SessionLocal` mock + `gen.__anext__()` で `session.py:12-13` カバレッジ解消（Loop 55）                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ユニット（frontend data.ts）                       |      34 | `getDecision` 全分岐（ok/danger-wind/danger-wave/danger-multi/land 陸上 null gate/**wind-warn(80%)/temp-warn/wave-warn(80%) 合成 site**）・`STATUS_LABEL`/`STATUS_CLASS`/`TYPE_LABEL`・`generateWeather`（known/fallback）・`generateMarine`（known/null）・`generateHourlyWind`/`generateHourlyWave`/`generateHistoricalMonthly`（shape/24h/12month）・`FORECAST_DAYS`/`WEATHER_ICONS`/`AUDIT_LOG`/`ETL_JOBS` shape — `synthSite()` factory パターン（Loop 47+57）                                                        |
| ユニット（frontend api.ts）                        |      51 | `APIError`・`WMCDSS_API_BASE`・`fetchJSON`（成功/4xx/5xx/body-read-fail）・`adaptSite`（全 fallback 分岐）・`fetchSitesFromBackend`/`fetchLatestWeather`/`Marine`（404/他エラー/成功）・`fetchThresholdsForSite`/`fetchAuditLog`（クエリ組み立て全分岐）・`requestDecisionFromBackend`（デフォルト 3h window 検証）・`initFromBackend`（ok/empty/unreachable/MOCK_SITES 退避）— `vi.stubGlobal('fetch')` + `vi.stubGlobal('window')` パターン（Loop 56）                                                                   |
| ユニット（frontend charts.tsx）                    |      36 | `ChartColors` 全 8 色 hex 検証・`LineChart`（empty→null/SVG/threshold 破線/thresholdLabel/yLabel/circle-per-point/custom-size）・`BarChart`（empty→null/viewBox/rect-per-point/yLabel）・`WindRose`（SVG/8方向ラベル/データドット数/N方向 `??` fix/empty/custom-size）・`Sparkline`（< 2 値→null/SVG/polyline/defaultSize）・`GaugeMeter`（SVG/value表示/unit/label/threshold marker/Loop17 fix threshAngle=0/red-amber-blue 色分岐/size）— `// @vitest-environment jsdom` ＋ `@testing-library/react` パターン（Loop 58） |
| ユニット（frontend decisions.tsx）                 |      21 | `CheckItem`（ok/warn/danger icon・badge text・badge class・value/unit・threshold・thresholdUnit）・`ConcretePage`（5 判定項目ラベル・判定項目カード・コンクリート打設判定タイトル・打設見通し・selectedSite prop・fallback）・`MarineWorkPage`（site selector・5 WORK_TYPES テーブル・海上作業判定タイトル・4 marine checks・波高推移・selectedSite prop）— jsdom + render() パターン（Loop 59）                                                                                                                           |
| ユニット（frontend dashboard.tsx）                 |      19 | `AlertBanner`（all-ok→null/danger banner/warn banner/shortName 表示/mixed danger+warn・**横並びチップ最大5件＋+N件バッジ**）・`SiteStatusCard`（shortName/決定バッジ/温度+風速/density padding diff/marine wave height/land rainfall）・`MapView`（div render/`L.map` 1回呼/`L.marker` × sites数/`onSiteClick` mount 時非呼・**全国zoom/エリアズーム**）・`DashboardPage`（4 stat cards/現場マップ/**エリアフィルターボタン**/現場ステータス/週間天気予報）— `vi.stubGlobal('L', mockL)` Leaflet mock パターン（Loop 59）                                                                                             |
| **E2E（Playwright / Firefox）**                    |   **5** | **sidebar・status badge・気象データ/海上作業ナビゲーション・ダッシュボード復帰 — `vite preview` のみ（backend 不要、Loop 49）**                                                                                                                                                                                                                                                                                                                                                                                            |
| API スモーク (要ライブ backend)                    |       9 | 起動中バックエンドに対する黒箱（audit 書込み契約を含む）                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ユニット（frontend weather-marine.tsx）            |      26 | `WeatherPage`（13 — 3 tab UI: current/hourly/table 切替 / 6 stat cards / 24h table / 風配図 / 週間予報）・`MarinePage`（12 — marine-only filter / 5 stat cards / 24h LineChart / 24-row 海象 table）— `vi.spyOn(Math, 'random')` 決定論化（Loop 60）                                                                                                                                                                                                                                                                       |
| ユニット（frontend analysis.tsx）                  |      27 | `HistoricalPage`（13 — 現場×年度×metric 軸 / wind/wave/rain で LineChart⇔BarChart swap / 12 月集計 table）・`Wave50Page`（13 — 再現期間別 8 行 table / 50年行 設計基準 badge / 観測点+推定手法 select）— カバレッジ 100% stmts（Loop 61）                                                                                                                                                                                                                                                                                  |
| ユニット（frontend app-shell.tsx）                 |      32 | `NAV_ITEMS`/`PAGE_TITLES`/`SvgIcon` pure exports（13）・`AppShell` first paint（8）・sidebar navigation（2）・role/theme persistence（7 — `Object.defineProperty(window, 'localStorage', { value: new InMemoryStorage() })` で jsdom + vitest v3.2.4 の Storage 半壊問題を回避）・window side-effects（1） — `vi.clearAllMocks()` 後の Leaflet mock 再注入パターン（Loop 62）                                                                                                                                              |
| ユニット（frontend site-pages.tsx）                |      31 | `SiteListPage`（9 — filter 4 ボタン / search / table 9-col / row click→site-detail）・`SiteRegisterPage`（8 — form / `vi.advanceTimersByTime(1300)` で setTimeout 1200ms 検証）・`SiteDetailPage`（13 — site fallback / quick actions / land vs marine 出し分け）（Loop 63）                                                                                                                                                                                                                                               |
| ユニット（frontend tweaks-panel.tsx）              |      41 | 11 components + 1 hook + dual-surface（Loop 64） — `TweaksPanel` postMessage protocol（`window.dispatchEvent(new MessageEvent(...))` + `await act(async)`）・`TweakRadio` ≤3 セグメント / >3 select fallback・`TweakNumber` clamp（min/max）・`TweakColor` 配列 vs string emit の型保持契約・`useTweaks` hook                                                                                                                                                                                                              |
| ユニット（frontend admin-pages.tsx）               |      34 | `ThresholdsPage`（7 — 編集→保存/取消切替・land "—"）・`EtlPage`（5 — 4 stats + ETL_JOBS テーブル）・`ReportsPage`（8 — 6 templates / 3 format btn / **vi.advanceTimersByTime(1600) で生成中→完了 transition**）・`AuditPage`（5 — filter dynamic action 抽出）・`SettingsPage`（7 — role別defaults / **2000ms 自動消去バナー**）（Loop 65）                                                                                                                                                                                |
| ユニット（frontend main.tsx）                      |       7 | bootstrap module を `vi.resetModules()` + `await import('../main')` で各 test 独立再起動。`BackendStatusStrip` の 5 分岐（undefined/ok+full/ok+missing/!ok+default/!ok+custom）+ AppShell mount + initFromBackend reject 時の catch path — main.tsx カバレッジ **100% stmts**（Loop 66）                                                                                                                                                                                                                                   |
| **合計**                                           | **571** | ✅ 各行の件数合計＝**571**（PR-D 適用後の実測値。適用前は 565 で、この合計行と 6 件ずれていた）。**【2026-08-06 実測 — 下記内訳は stale】** 「backend unit 197/197 + frontend unit 360/360 + E2E 5/5」は本表の更新が止まった時点の値であり、合計 562 で `571` とも一致していない。**実測は backend unit 295**（`pytest --ignore=tests/test_api_smoke.py`）／**frontend unit 587**（23 files）／**E2E 38**（4 spec files）＝ **920**。PR-D では自身が変更した 2 行のみ更新しており、他行の件数と coverage（backend **99%** / frontend **96.03% Statements・82.67% Branches**）は**未再測定**。表全体の再突合は別 PR のバックログとする。smoke は `docker compose up` 環境で別実行 |

### 📊 Frontend Coverage Matrix

> 12 source modules / 17 test files / **444 tests** / **98.05% statements** / **90.53% branches** / **92.41% functions** を Loop 78 以降で達成。

| Module                  | Statements |   Branches |  Functions |   Tests |         Loops |
| ----------------------- | ---------: | ---------: | ---------: | ------: | ------------: |
| 🟢 `api.ts`             |     97.41% |     83.33% |       100% |      51 |            56 |
| 🟢 `data.ts`            |       100% |     95.65% |       100% |      34 |         47+57 |
| 🟢 `charts.tsx`         |       100% |     91.37% |       100% |      36 |            58 |
| 🟢 `dashboard.tsx`      |       100% |     94.73% |       100% |      31 |      59+71+78 |
| 🟢 `decisions.tsx`      |       100% |     95.23% |       100% |      38 | 59+70+77+78   |
| 🟢 `weather-marine.tsx` |     96.18% |     85.48% |       100% |      28 |         60+72 |
| 🟢 `analysis.tsx`       |       100% |     92.00% |     85.71% |      27 |            61 |
| 🟢 `app-shell.tsx`      |     97.37% |     88.88% |     80.00% |      46 |      62+68+74 |
| 🟢 `site-pages.tsx`     |       100% |       100% |       100% |      46 |         63+79 |
| 🟢 `tweaks-panel.tsx`   |       100% |     93.28% |     94.87% |      58 |      64+67+80 |
| 🟢 `admin-pages.tsx`    |     99.80% |     96.00% |       100% |      41 |         65+75 |
| 🟢 `main.tsx`           |       100% |     90.90% |       100% |       7 |            66 |
| **All files**           | **99.27%** | **93.02%** | **95.91%** | **444** |             — |

> セッション 2026-05-28 で Loop 59 → 75 を実行。frontend test **121 → 401** (+280, +231%)、coverage **32.26% → 97.68% Statements** (+65.42pt) / Branches → **87.10%** / Functions → **89.65%**。詳細: [docs/SESSION-2026-05-28.md](SESSION-2026-05-28.md)
> セッション 2026-06-05 で Loop 77 → 80 を実行。frontend test **401 → 443** (+42)、coverage **97.68% → 99.27% Statements** (+1.59pt) / Branches **87.10% → 93.02%** (+5.92pt) / Functions **89.65% → 95.91%** (+6.26pt)。decisions.tsx/dashboard.tsx/site-pages.tsx/tweaks-panel.tsx Stmts **100%** 達成。site-pages.tsx **Stmts/Branches/Funcs すべて 100%** 達成（初の完全カバレッジモジュール）。

### 🤖 継続的インテグレーション

`push` / `pull_request` (→ `main`) で `.github/workflows/ci.yml` が **六段ジョブ**として起動：

| ジョブ                                                    | ステップ                                                                                                                                                                   |        並走         | 失敗時の影響      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-----------------: | ----------------- |
| `backend-unit`                                            | `ruff check .` ／ `pytest --ignore=tests/test_api_smoke.py` (197 件)                                                                                                       |          —          | ❌ マージブロック |
| `backend-smoke` (`needs: backend-unit`)                   | `docker compose up -d --wait` ／ `/readyz` ポーリング ／ `pytest tests/test_api_smoke.py` (9 件)                                                                           |       unit 後       | ❌ マージブロック |
| `frontend-unit` (Loop 47 追加 / Loop 60-80 拡張)          | `npm ci` ／ `vitest run` (**444 件 / 17 files / coverage 99.27% Stmts / 93.02% Branches / 95.91% Funcs**)                                                                 | backend-unit と並走 | ❌ マージブロック |
| `frontend-build` (`needs: frontend-unit`)                 | `npm ci` ／ `npm run build` ／ bundle size 報告                                                                                                                            |       unit 後       | ❌ マージブロック |
| `frontend-e2e` (`needs: frontend-build`) **Loop 49 追加** | `npm ci` ／ `playwright install --with-deps firefox` ／ `playwright test` (5 件 — `vite preview` 内蔵、backend 不要)                                                       |      build 後       | ❌ マージブロック |
| `frontend-docker` (Loop 38 追加)                          | `docker buildx build` で `frontend/vite-app/Dockerfile` を multi-stage build（host の `npm run build` では検出不能な Docker context-escape ／ nginx eager DNS を機械検出） |     unit と並走     | ❌ マージブロック |

> 📝 backend-unit と frontend-unit が並走してトータル壁時計時間を最小化。`frontend-build` は `frontend-unit` 通過後のみ起動し、vitest が落ちているときに重い build を走らせない。`frontend-e2e` は `frontend-build` 後に起動し、build 失敗時に E2E を走らせない。smoke は同じコマンドでローカルでも再現可能 (`docker compose exec backend pytest tests/test_api_smoke.py`)。

---

## 📚 関連ドキュメント

- 🏛️ [アーキテクチャ](ARCHITECTURE.md) — レイヤ構成・データフロー・採用判断・CI 二段構え
- 🔐 [セキュリティ設計](SECURITY.md) — 認証・監査・タイミング攻撃対策
- 🔑 [認証設計](AUTH-DESIGN.md) — API キー方式の設計判断
- 🛠️ [運用ガイド](../deploy/systemd/README.md) — systemd timer のインストール
- 📊 [プロジェクトステータス](STATUS.md) — フェーズ進捗・残日数・ブロッカー
- 🪟 [Windows 11 デプロイ情報](WINDOWS11-DEPLOY-INFO.md) — Windows 環境での導入
