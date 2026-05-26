# 🌊 WMCDSS — Weather-Marine Construction Decision Support System

> 現場気象海象 自動集計・施工判断支援システム
>
> 気象庁 (JMA) の AMeDAS・波浪データを自動取得し、現場ごとの閾値判定に基づいて
> 「⛏️ 着手可」「⚠️ 警戒」「⛔ 中止」を提示するダッシュボード兼 API。

[![tests](https://img.shields.io/badge/tests-82%20unit%20%2B%209%20smoke-brightgreen)](#-テスト)
[![ci](https://img.shields.io/badge/CI-ruff%20%2B%20pytest%20%2B%20vite%20%2B%20docker-2088FF)](.github/workflows/ci.yml)
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
| 🖥️ Frontend | React 18 + Vite 6 + TypeScript（**全 15 ページ ESM port 完了 ＋ density/dark/role 永続化**）<br/>React + Babel Standalone（並行稼働 fallback） | `frontend/vite-app/`（primary, nginx 配信）<br/>`frontend/`（fallback, 静的） | ダッシュボード・現場/閾値管理画面（mock 警告帯付き・localStorage 永続化） |
| 🌐 Frontend エッジ | nginx 1.27-alpine（multi-stage Docker build, lazy DNS） | `frontend/vite-app/Dockerfile`<br/>`frontend/vite-app/nginx.conf` | Vite 静的配信 ＋ `/api/` reverse proxy ＋ `/readyz` passthrough |
| 🐍 Backend API | FastAPI + SQLAlchemy 2.0 async | `backend/app/` | 観測値・閾値・判定 REST API |
| 🗄️ DB | PostgreSQL 16 | `db/migrations/` | 観測値・現場・閾値・監査ログ |
| ⏱️ Ingester | httpx + systemd timer | `backend/app/jobs/ingest_jma{,_marine}.py`<br/>`deploy/systemd/` | AMeDAS（10 分毎）／wave nowcast（毎時）の 2 系統並走 |
| 🔐 Auth | API Key middleware | `backend/app/core/security.py` | mutation エンドポイントを保護 |
| 🚦 Rate Limit | Sliding window middleware | `backend/app/core/ratelimit.py` | identity 単位 (key hash / IP) の濫用防御 |
| 📜 Audit | Service-level audit writes | `backend/app/services/audit.py` | 変更の actor/detail を永続化 |

---

## 🔌 API エンドポイント一覧

| Method | Path | 認証 | 用途 |
|---|---|---|---|
| `GET`  | `/healthz` `/readyz` | 不要 | プロセス/DB liveness |
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
open frontend/index.html   # window.WMCDSS_API_BASE は同ホスト :8003 自動推定
```

### 🆕 Vite ビルド（**全ページ ESM port 完了 ＋ Docker 配信 hardened**）

`frontend/vite-app/` は **Phase 1（15 ページ ESM port）→ Phase 2 入口（Loop 26 で本番 entry 化）→ TweaksPanel/role/density/dark/persistence 配線（Loop 29-34）→ docker-compose 配下に nginx service 化（Loop 36）→ Dockerfile build context-escape ＋ nginx eager DNS の 2 件 latent bug を解消（Loop 38）**まで前進。Babel Standalone 系統（`frontend/index.html`）は fallback として並行稼働中。

- ✅ `src/api.ts` — `../api.jsx` の ESM/TS 版（named exports ＋ `window.WMCDSS_API` 副作用維持）
- ✅ `src/app-shell.tsx` — root sidebar + header + 15-page router（`PageId` 15-member literal union ＋ exhaustive `Record<PageId, string>`）＋ density / role / dark mode 配線（Loop 30）
- ✅ `src/{dashboard,decisions,weather-marine,analysis,site-pages,admin-pages,concrete-marine-work,charts,data}.tsx` — 全 15 ページ ESM port 完
- ✅ `src/main.tsx` — `WMCDSS_API.initFromBackend()` を `.finally(render)` chain で先行実行 ＋ inline `<MockBanner />` で `window.BACKEND_STATUS?.ok` 未接続時に「施工判断には使用しないでください」赤帯表示（legacy index.html Root と意味論一致）／成功時は live sites 数を緑帯表示（Loop 33）
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
| ユニット（auth middleware） | 23 | API Key 認証・exempt パス・タイミング攻撃耐性・非 ASCII 鍵拒否・過大鍵 DoS 防御・header 多重指定・空 keys 設定の閉鎖（Loop 37 で 9 → 23 へ拡張） |
| ユニット（rate limit middleware） | 13 | sliding window・bucket 分離・window 期限切れ復活・exempt パス・identity hashing 漏洩防止／**FIFO identity eviction 3 件（Loop 41 — `_MAX_IDENTITIES=4096` の X-API-Key 量産 DoS 防壁を構造検証）** |
| ユニット（audit hardening） | 9 | actor_from の API Key 漏洩防止・write_audit strict モードの SQLAlchemyError 伝播 |
| ユニット（JMA AMeDAS fetcher） | 6 | パース・品質フラグ・block ロールバック・QC-drop 検出 |
| ユニット（JMA wave fetcher） | 9 | パース・grid snap・日跨ぎ fallback・5xx 伝播・sentinel 値除外・scalar/tuple 両対応 |
| ユニット（decisions） | 18 | 判定ロジック・閾値マージ・境界値・OR-merge 優先度・欠測補完（Loop 35 で 7 → 18 へ拡張） |
| ユニット（OpenAPI exposure policy） | 4 | env スイッチで `/openapi.json`・`/docs`・`/redoc` を 404 化／無効でも `/healthz` ・`/` endpoints list は残る |
| API スモーク (要ライブ backend) | 9 | 起動中バックエンドに対する黒箱（audit 書込み契約を含む） |
| **合計** | **91** | ✅ unit 82/82 passing — smoke は `docker compose up` 環境で別実行 |

### 🤖 継続的インテグレーション

`push` / `pull_request` (→ `main`) で `.github/workflows/ci.yml` が **四段ジョブ**として起動：

| ジョブ | ステップ | 並走 | 失敗時の影響 |
|---|---|:--:|---|
| `backend-unit` | `ruff check .` ／ `pytest --ignore=tests/test_api_smoke.py` (82 件) | — | ❌ マージブロック |
| `backend-smoke` (`needs: backend-unit`) | `docker compose up -d --wait` ／ `/readyz` ポーリング ／ `pytest tests/test_api_smoke.py` (9 件) | unit 後 | ❌ マージブロック |
| `frontend-build` | `npm ci` (lockfile-pinned) ／ `npm run build` ／ bundle size 報告 | unit と並走 | ❌ マージブロック |
| `frontend-docker` (Loop 38 追加) | `docker buildx build` で `frontend/vite-app/Dockerfile` を multi-stage build（host の `npm run build` では検出不能な Docker context-escape ／ nginx eager DNS を機械検出） | unit と並走 | ❌ マージブロック |

> 📝 unit を先に落とすことで、compose 起動 (〜90s) のコストを回帰の早期発見と引き換えに最小化。`frontend-build` と `frontend-docker` は `backend-unit` と並走し、壁時計時間に影響しない (実測: frontend-build 9s ／ frontend-docker 〜45s ／ unit 26s ／ smoke 40s)。smoke は同じコマンドでローカルでも再現可能 (`docker compose exec backend pytest tests/test_api_smoke.py`)。

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
