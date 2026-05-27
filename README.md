# 🌊 WMCDSS — Weather-Marine Construction Decision Support System

> 現場気象海象 自動集計・施工判断支援システム
>
> 気象庁 (JMA) の AMeDAS・波浪データを自動取得し、現場ごとの閾値判定に基づいて
> 「⛏️ 着手可」「⚠️ 警戒」「⛔ 中止」を提示するダッシュボード兼 API。

[![tests](https://img.shields.io/badge/tests-197%20unit%20%2B%205%20E2E%20%2B%209%20smoke-brightgreen)](#-テスト)
[![ci](https://img.shields.io/badge/CI-ruff%20%2B%20pytest%20%2B%20vitest%20%2B%20vite%20%2B%20docker-2088FF)](.github/workflows/ci.yml)
[![python](https://img.shields.io/badge/python-3.11%2B-blue)]()
[![fastapi](https://img.shields.io/badge/FastAPI-0.115%2B-009688)]()
[![postgres](https://img.shields.io/badge/Postgres-16-336791)]()

---

## 🎯 何を解決するか

| 課題 | 従来 | このシステム |
|---|---|---|
| 🌤️ 気象データ収集 | 各人が JMA サイトを毎朝目視 | systemd タイマで 10 分毎に自動取得 |
| 📏 中止判断の基準 | 現場ごとに口頭・経験則 | DB 管理された閾値で機械判定 |
| 📝 判断の根拠 | 議事録・チャットに散在 | `audit_log` に actor + 入力 + 判定を全件記録 |
| 📱 共有 | 朝礼・電話 | ブラウザのダッシュボード（任意端末） |

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

詳細は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を参照。

---

## 🧩 主要コンポーネント

| レイヤ | 技術 | パス | 役割 |
|---|---|---|---|
| 🖥️ Frontend | React 18 + Vite 6 + TypeScript（**全 15 ページ ESM port 完了 ＋ density/dark/role 永続化 ＋ Babel Standalone 完全退役 Loop 44**） | `frontend/vite-app/`（唯一の entry, nginx multi-stage 配信） | ダッシュボード・現場/閾値管理画面（mock 警告帯付き・localStorage 永続化） |
| 🌐 Frontend エッジ | nginx 1.27-alpine（multi-stage Docker build, lazy DNS） | `frontend/vite-app/Dockerfile`<br/>`frontend/vite-app/nginx.conf` | Vite 静的配信 ＋ `/api/` reverse proxy ＋ `/readyz` passthrough |
| 🐍 Backend API | FastAPI + SQLAlchemy 2.0 async（**Loop 46: docker healthcheck で `/readyz` を judge — `compose up --wait` が DB 接続成立まで待つようになり frontend は `service_healthy` 依存に格上げ**） | `backend/app/` | 観測値・閾値・判定 REST API |
| 🗄️ DB | PostgreSQL 16 | `db/migrations/` | 観測値・現場・閾値・監査ログ |
| ⏱️ Ingester | httpx + systemd timer | `backend/app/jobs/ingest_jma{,_marine}.py`<br/>`deploy/systemd/` | AMeDAS（10 分毎）／wave nowcast（毎時）の 2 系統並走 |
| 🔐 Auth | API Key middleware | `backend/app/core/security.py` | mutation エンドポイントを保護 |
| 🚦 Rate Limit | Sliding window middleware | `backend/app/core/ratelimit.py` | identity 単位 (key hash / IP) の濫用防御 |
| 📊 Monitoring | prometheus_client 0.21+ | `backend/app/core/monitoring.py`<br/>`backend/app/api/metrics.py` | Prometheus 形式 `/metrics` エンドポイント — リクエスト数・レイテンシヒストグラム（Loop 50） |
| 📜 Audit | Service-level audit writes | `backend/app/services/audit.py` | 変更の actor/detail を永続化 |

---

## 🔌 API エンドポイント一覧

| Method | Path | 認証 | 用途 |
|---|---|---|---|
| `GET`  | `/healthz` `/readyz` | 不要 | プロセス/DB liveness |
| `GET`  | `/metrics` | 不要 | Prometheus スクレープエンドポイント（`text/plain; version=0.0.4`） |
| `GET`  | `/api/v1/sites` | 不要 | 現場一覧 |
| `POST` | `/api/v1/sites` | 🔐 必要 | 現場登録（`audit_log` に記録） |
| `POST` | `/api/v1/decisions` | 🔐 必要 | 期間内観測値から判定を計算（`audit_log` に記録） |
| `GET`  | `/api/v1/thresholds` | 不要 | site/work_type ごとの閾値（OR-merge） |
| `POST` `PUT` `DELETE` | `/api/v1/thresholds` | 🔐 必要 | 閾値 CRUD |
| `POST` | `/api/v1/observations/weather` | 🔐 必要 | AMeDAS 観測値の upsert（バッチ） |
| `GET`  | `/api/v1/observations/weather` | 不要 | 期間内観測値 |
| `GET`  | `/api/v1/observations/weather/latest` | 不要 | 最新観測値 |
| `POST` | `/api/v1/observations/marine` | 🔐 必要 | 波浪観測値の upsert |
| `GET`  | `/api/v1/observations/marine[/latest]` | 不要 | 海象観測値 |
| `GET`  | `/api/v1/audit` | 不要 | 監査ログ |

🔐 = `X-API-Key` ヘッダ必須（`WMCDSS_API_KEYS` 環境変数で設定）

---

## 🚀 ローカル起動（5 分）

```bash
# 1. リポジトリ取得
git clone <repo> wmcdss && cd wmcdss

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

| 変数 | 既定 | 用途 |
|---|---|---|
| `WMCDSS_DATABASE_URL` | `postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss` | DB 接続 |
| `WMCDSS_API_KEYS` | （空＝認証無効） | カンマ区切りの API キー一覧 |
| `WMCDSS_CORS_ORIGINS` | 192.168.0.185:8888 等 | CORS 許可元 |
| `WMCDSS_JMA_USER_AGENT` | `wmcdss/0.1 (+contact: …)` | JMA への User-Agent |
| `WMCDSS_RATE_LIMIT_PER_MINUTE` | `0`（無効） | mutation の identity 単位 60-秒 sliding window cap |
| `WMCDSS_EXPOSE_OPENAPI` | `true`（dev） | `false` で `/openapi.json`・`/docs`・`/redoc` を 404 に — 本番でスキーマを匿名公開しない |

---

## ⏱️ JMA 自動取得（systemd timer）

```bash
cp deploy/systemd/wmcdss-jma-fetch.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
loginctl enable-linger "$USER"
```

`OnCalendar=*:0/10:30` で AMeDAS の 10 分粒度ティックを取得。`Persistent=true` で
停止中の取りこぼしも次回起動時に自動補正。詳細 → [`deploy/systemd/README.md`](deploy/systemd/README.md)

---

## 🧪 テスト

```bash
docker compose exec backend pytest -q tests/
```

| グループ | 件数 | 内容 |
|---|---:|---|
| ユニット（auth middleware） | 28 | API Key 認証・exempt パス・タイミング攻撃耐性・非 ASCII 鍵拒否・過大鍵 DoS 防御・header 多重指定・空 keys 設定の閉鎖（Loop 37 で 9 → 23 へ拡張）／**境界値 + パス prefix 5 件（Loop 48 — 空白パディング鍵拒否・512 境界包含・サブパス exempt・隣接パス漏洩防止）** |
| ユニット（rate limit middleware） | 17 | sliding window・bucket 分離・window 期限切れ復活・exempt パス・identity hashing 漏洩防止／**FIFO identity eviction 3 件（Loop 41）**／**境界値 4 件（Loop 48 — client=None identity・window 境界厳密一致・PUT/PATCH/DELETE rate-limit・最終許可リクエストの remaining=0）** |
| ユニット（audit hardening） | 9 | actor_from の API Key 漏洩防止・write_audit strict モードの SQLAlchemyError 伝播 |
| ユニット（JMA AMeDAS fetcher） | 16 | パース・品質フラグ・block ロールバック・QC-drop 検出／error-propagation 6 件（Loop 42）／**純粋関数 edge case 4 件 — `_val()` 非数値・`_wind_dir_deg()` non-list/TypeError・`_latest_entry()` non-dict — `jma.py:56-57/63/66-67/84` カバレッジ完全解消（Loop 55）** |
| ユニット（JMA wave fetcher） | 17 | パース・grid snap・日跨ぎ fallback・sentinel 値除外・scalar/tuple 両対応／error-propagation 5 件（Loop 43）／**純粋関数 edge case 3 件 — `_val()` 短リスト/非数値・`_latest_entry()` non-dict — `jma_wave.py:75/87-88/104` カバレッジ完全解消（Loop 55）** |
| ユニット（decisions） | 18 | 判定ロジック・閾値マージ・境界値・OR-merge 優先度・欠測補完（Loop 35 で 7 → 18 へ拡張） |
| ユニット（OpenAPI exposure policy） | 4 | env スイッチで `/openapi.json`・`/docs`・`/redoc` を 404 化／無効でも `/healthz` ・`/` endpoints list は残る |
| ユニット（health / readiness probes） | 3 | `/healthz` は常時 200・`/readyz` は DB 健全時 200／DB 失敗時 **503**（Loop 45 — orchestrator contract pin: k8s/docker healthcheck/LB/`curl -sf` が HTTP status のみで readiness を判定するため、`{"status":"degraded"}` を 200 で返す silent failure を構造修正） |
| ユニット（Prometheus `/metrics`） | 6 | 200/content-type/auth 免除/rate-limit 免除/`wmcdss_http_requests_total` カウンター/`wmcdss_http_request_duration_seconds` ヒストグラム の存在を構造 pin — prometheus scraper は認証不要（Loop 50） |
| ユニット（observations API） | 13 | GET weather/marine list・latest 404/200・POST ingest empty/1-row — `_FakeResult` + `_FakeDB` duck-type で全 6 エンドポイントをカバー（Loop 51） |
| ユニット（sites API） | 6 | GET list/404/200・POST 409 重複・POST 201 新規 — `_FakeDB.refresh()` で `id`/`created_at`/`updated_at` を注入（Loop 52） |
| ユニット（thresholds API） | 10 | GET list（site_id/work_type フィルタ）・GET 404/200・POST 201・PATCH 404/200・DELETE 404/204（Loop 52） |
| ユニット（decisions API） | 11 | POST 400 window 逆順/同一・go/caution/stop 判定・severity 優先度（挿入順両方）・go-not-met・レスポンス shape・marine stop・write_audit strict=True ロールバック（`_FlushFailDB` + `raise_server_exceptions=False`）（Loop 53） |
| ユニット（audit API） | 13 | GET empty/rows/actor/action/limit フィルタ・null actor・detail フィールド・limit>1000→422・t0/t1/target_type/target_id パラメータ受理・AuditOut 7 フィールド全確認（Loop 53） |
| ユニット（weather ingest job） | 12 | `run_once()` 10 分岐（Loop 54）／**`main()` success+exception の sync テスト 2 件 — `asyncio.run` patch で `ingest_jma.py:156-165` カバレッジ解消（Loop 55）** |
| ユニット（marine ingest job） | 12 | `run_once()` 10 分岐（Loop 54）／**`main()` success+exception の sync テスト 2 件 — `ingest_jma_marine.py:172-181` カバレッジ解消（Loop 55）** |
| ユニット（security `_key_matches` bytes ブランチ） | 1 | `bytes` 入力 → `AttributeError` → `return False` — `security.py:55-56` カバレッジ完全解消（Loop 54） |
| ユニット（`get_db()` async generator） | 1 | `SessionLocal` mock + `gen.__anext__()` で `session.py:12-13` カバレッジ解消（Loop 55） |
| ユニット（frontend data.ts） | 11 | `getDecision` 全分岐（ok / danger-wind / danger-wave / danger-multi / land 陸上 null gate）・`STATUS_LABEL` / `STATUS_CLASS` / `TYPE_LABEL` 定数 mapping — vitest 3.x（Loop 47） |
| **E2E（Playwright / Firefox）** | **5** | **sidebar・status badge・気象データ/海上作業ナビゲーション・ダッシュボード復帰 — `vite preview` のみ（backend 不要、Loop 49）** |
| API スモーク (要ライブ backend) | 9 | 起動中バックエンドに対する黒箱（audit 書込み契約を含む） |
| **合計** | **213** | ✅ backend unit 197/197 + frontend unit 11/11 + E2E 5/5 — coverage 99% — smoke は `docker compose up` 環境で別実行 |

### 🤖 継続的インテグレーション

`push` / `pull_request` (→ `main`) で `.github/workflows/ci.yml` が **六段ジョブ**として起動：

| ジョブ | ステップ | 並走 | 失敗時の影響 |
|---|---|:--:|---|
| `backend-unit` | `ruff check .` ／ `pytest --ignore=tests/test_api_smoke.py` (197 件) | — | ❌ マージブロック |
| `backend-smoke` (`needs: backend-unit`) | `docker compose up -d --wait` ／ `/readyz` ポーリング ／ `pytest tests/test_api_smoke.py` (9 件) | unit 後 | ❌ マージブロック |
| `frontend-unit` (Loop 47 追加) | `npm ci` ／ `vitest run` (11 件) | backend-unit と並走 | ❌ マージブロック |
| `frontend-build` (`needs: frontend-unit`) | `npm ci` ／ `npm run build` ／ bundle size 報告 | unit 後 | ❌ マージブロック |
| `frontend-e2e` (`needs: frontend-build`) **Loop 49 追加** | `npm ci` ／ `playwright install --with-deps firefox` ／ `playwright test` (5 件 — `vite preview` 内蔵、backend 不要) | build 後 | ❌ マージブロック |
| `frontend-docker` (Loop 38 追加) | `docker buildx build` で `frontend/vite-app/Dockerfile` を multi-stage build（host の `npm run build` では検出不能な Docker context-escape ／ nginx eager DNS を機械検出） | unit と並走 | ❌ マージブロック |

> 📝 backend-unit と frontend-unit が並走してトータル壁時計時間を最小化。`frontend-build` は `frontend-unit` 通過後のみ起動し、vitest が落ちているときに重い build を走らせない。`frontend-e2e` は `frontend-build` 後に起動し、build 失敗時に E2E を走らせない。smoke は同じコマンドでローカルでも再現可能 (`docker compose exec backend pytest tests/test_api_smoke.py`)。

---

## 🗺️ ロードマップ

| フェーズ | 期間 | 内容 |
|---|---|---|
| Month 1〜2 | 基盤整備 | DB スキーマ・API・JMA ingest（**ここまで完了**） |
| Month 3〜4 | 品質向上 | 自動レビュー組込・E2E テスト・モニタリング |
| Month 5 | 統合テスト | 実現場 1 件で運用試験 |
| Month 6 | リリース準備 | CHANGELOG・タグ・本番移行 |

> 🗓️ 本番リリース期限：登録から 6 ヶ月後（絶対厳守）

---

## 📚 ドキュメント

- 🏛️ [アーキテクチャ](docs/ARCHITECTURE.md) — レイヤ構成・データフロー・採用判断・CI 二段構え
- 🔐 [セキュリティ設計](docs/SECURITY.md) — 認証・監査・タイミング攻撃対策
- 🛠️ [運用ガイド](deploy/systemd/README.md) — systemd timer のインストール
- 📊 [プロジェクトステータス](docs/STATUS.md) — フェーズ進捗・残日数・ブロッカー（GitHub Projects 等価）

---

## 🧾 ライセンス

社内利用（要件確定後に決定）。
