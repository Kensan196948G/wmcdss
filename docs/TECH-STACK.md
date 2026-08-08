# 🛠️ 技術スタック詳細

> **対象読者**: IT 部門、システム開発者、技術評価担当者
> WMCDSS で使用しているすべての技術・ライブラリを解説します。

---

## 📋 目次

1. [全体構成図](#-全体構成図)
2. [バックエンド（API サーバ）](#-バックエンドapi-サーバ)
3. [フロントエンド（WebUI）](#-フロントエンドwebui)
4. [データベース](#-データベース)
5. [インフラ・コンテナ](#-インフラコンテナ)
6. [気象データ取得](#-気象データ取得)
7. [認証・セキュリティ](#-認証セキュリティ)
8. [CI/CD・品質管理](#-cicd品質管理)
9. [バージョン一覧](#-バージョン一覧)

---

## 🗺️ 全体構成図

```
┌──────────────────────────────────────────────────────────────────────┐
│  社内ネットワーク（LAN）                                               │
│                                                                       │
│  ┌──────────────┐   HTTP    ┌─────────────────────────────────────┐  │
│  │ ブラウザ端末  │ ────────▶ │  🖥️  フロントエンド（Nginx + React） │  │
│  │ PC・スマホ   │  :9080    │  ・SPA（シングルページアプリ）       │  │
│  └──────────────┘           │  ・Vite ビルド / TypeScript         │  │
│                             │  ・Leaflet マップ / 独自 SVG チャート  │  │
│                             └───────────────┬─────────────────────┘  │
│                                             │ HTTP REST API           │
│                                             ▼  :8003                  │
│                             ┌─────────────────────────────────────┐  │
│                             │  ⚙️  バックエンド（FastAPI / Python） │  │
│                             │  ・JWT 認証 / ロール制御             │  │
│                             │  ・施工判定エンジン                  │  │
│                             │  ・気象データ変換・集計              │  │
│                             └───────────────┬─────────────────────┘  │
│                                             │ PostgreSQL              │
│                                             ▼  :5432（内部）          │
│                             ┌─────────────────────────────────────┐  │
│                             │  🗄️  データベース（PostgreSQL）        │  │
│                             │  ・気象観測データ蓄積                │  │
│                             │  ・ユーザー・権限管理                │  │
│                             │  ・監査ログ永続化                    │  │
│                             └─────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  🕐 定期実行（systemd タイマー）                               │    │
│  │  ・AMeDAS 10 分ごと → backend コンテナで Python Job 実行      │    │
│  │  ・波浪データ 1 時間ごと → backend コンテナで Python Job 実行 │    │
│  │  ・気象庁 API (JMA) へのアウトバウンド通信のみ               │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘

  🐳 Docker Compose でフロントエンド・API・DB を一体管理
  ⚙️  systemd user units で OS 起動時に自動起動
```

---

## ⚙️ バックエンド（API サーバ）

### 🐍 Python 3.11+

`pyproject.toml` は `requires-python = ">=3.11"`。CI は 3.12 で実行。型ヒントの強化、パフォーマンス改善、セキュリティパッチ対応が充実。

### ⚡ FastAPI

| 項目 | 詳細 |
|---|---|
| 役割 | REST API フレームワーク |
| 選定理由 | 型安全・自動ドキュメント生成・高パフォーマンス |
| 主要機能 | JWT 認証（ロール制御は未実装・将来課題）、リクエストバリデーション |
| ドキュメント | `/api/docs`（Swagger UI）で自動生成 |

```
GET  /healthz                   ← プロセス死活監視
GET  /readyz                    ← DB 健全性含む準備状態
GET  /metrics                   ← Prometheus メトリクス
POST /api/v1/auth/login         ← ログイン（JWT 発行）
GET  /api/v1/sites              ← 現場一覧
POST /api/v1/decisions          ← 施工判定
GET  /api/v1/thresholds         ← しきい値一覧
GET  /api/v1/observations/weather ← 気象観測値
GET  /api/v1/observations/marine  ← 海象観測値
```

### 🔷 SQLAlchemy 2.x + 独自マイグレーションランナー

| ライブラリ | 役割 |
|---|---|
| SQLAlchemy | ORM（Python オブジェクト ↔ DB テーブル変換） |
| 独自ランナー | `app/db/migrate.py` — advisory lock + checksum + `schema_migrations` テーブルによる版管理 |
| asyncpg | 非同期 PostgreSQL ドライバ（高速処理） |

※ Alembic は使用していない。独自ランナーは `db/migrations/*.sql` を番号順に適用し、checksum 照合で改竄を検出する。

### 📦 主要 Python ライブラリ

| ライブラリ | バージョン | 用途 |
|---|---|---|
| `fastapi` | 0.115+ | API フレームワーク |
| `uvicorn` | 0.34+ | ASGI サーバ |
| `sqlalchemy` | 2.0+ | ORM |
| `pydantic` | 2.10+ | データバリデーション |
| `PyJWT` | 2.10+ | JWT 生成・検証（`python-jose` から移行済み） |
| `bcrypt` | 3.2+ | パスワードハッシュ |
| `httpx` | 0.28+ | JMA API 呼び出し |
| `aiofiles` | 24.x | 非同期ファイル I/O |

---

## 🖥️ フロントエンド（WebUI）

### ⚛️ React 19 + TypeScript

```
React（UI コンポーネント）
  ├── useState / useEffect（状態管理）
  ├── React Context（認証状態グローバル共有）
  └── Custom Hooks（気象データ取得・判定ロジック）

TypeScript（型安全）
  ├── 厳格な型定義（strict: true）
  ├── API レスポンスの型推論
  └── Interface 定義（WeatherData, Site, WorkTask, etc.）
```

### ⚡ Vite 6

| 項目 | 詳細 |
|---|---|
| 役割 | フロントエンドビルドツール |
| 選定理由 | 高速ビルド（esbuild ベース）、HMR（開発時即時反映） |
| 本番ビルド | `npm run build` → `dist/` に静的ファイル生成 |
| Nginx 配信 | ビルド成果物を Nginx コンテナで配信 |

### 🗺️ Leaflet.js（地図表示）

```
Leaflet（地図ライブラリ）
  ├── OpenStreetMap タイル（無料・著作権表示必須）
  ├── 現場マーカー（状態別カラーコード）
  │     🟢 green  → 施工可能
  │     🟡 yellow → 要注意
  │     🔴 red    → 施工不可
  └── クリックでポップアップ（気象データ詳細）
```

### 🖌️ 独自 SVG チャート（Chart.js 不使用）

Chart.js は使っていない。`charts.tsx` で React SVG コンポーネント（LineChart, BarChart, WindRose, Sparkline, GaugeMeter）を実装。

| グラフ種別 | 用途 |
|---|---|
| 折れ線グラフ | 気温・風速の時系列変化（独自 SVG LineChart） |
| 棒グラフ | 降水量・波高の日別比較（独自 SVG BarChart） |
| 風配図 | 風向・風速の分布（独自 SVG WindRose） |
| スパークライン | 小型トレンド表示（独自 SVG Sparkline） |
| ゲージメーター | 現在値の可視化（独自 SVG GaugeMeter） |

### 📦 主要 npm パッケージ

| パッケージ | バージョン | 用途 |
|---|---|---|
| `react` | 19.2+ | UI フレームワーク |
| `vite` | 6.0+ | ビルドツール |
| `leaflet` | （CDN 読み込み） | 地図表示 |
| `react-leaflet` | （未使用） | React 向け Leaflet ラッパー |

> ※ chart.js / react-chartjs-2 / typescript は依存関係に含まれない。TypeScript は Vite バンドルに内包。

---

## 🗄️ データベース

### 🐘 PostgreSQL 16

```
wmcdss データベース
  │
  ├── sites（現場マスタ）
  │     id / code / name / kind / lat / lon / jma_station_id
  │     wave_grid_lat / wave_grid_lon / address / note
  │
  ├── weather_observations（気象観測データ）
  │     id / site_id / observed_at / temperature_c / humidity_pct
  │     pressure_hpa / precip_mm / wind_speed_ms / wind_gust_ms
  │     wind_dir_deg / sunshine_h / fetched_at / source
  │
  ├── marine_observations（波浪観測データ）
  │     id / site_id / observed_at / sig_wave_h_m / wave_period_s
  │     wave_dir_deg / tide_level_m / current_speed_ms / current_dir_deg
  │
  ├── forecasts（予報スナップショット）
  │     id / site_id / forecast_for / issued_at / domain / payload
  │
  ├── thresholds（判定しきい値）
  │     id / site_id / work_type / metric / op / value / severity
  │     active_from / active_to / note
  │
  ├── decisions（判定結果）
  │     id / site_id / work_type / target_window_start / target_window_end
  │     status / reason / inputs / thresholds_snapshot
  │
  ├── users（ユーザー）
  │     id / email / display_name / role / is_active / created_at
  │
  ├── audit_log（監査ログ）
  │     id / occurred_at / actor / action / target_type / target_id / detail
  │
  └── etl_runs（ETL 実行状態）
        id / job / status / started_at / finished_at / rows_in / rows_out
```

### 接続設定

| 項目 | 値 |
|---|---|
| 内部ポート | 5432（コンテナ間通信のみ） |
| 外部ポート | 5434（ローカルホスト限定・デバッグ用） |
| 接続ユーザー | `wmcdss`（専用ユーザー、最小権限） |
| DB 名 | `wmcdss` |
| 文字コード | UTF-8 |

---

## 🐳 インフラ・コンテナ

### Docker Compose 構成

```yaml
services:
  db:          # PostgreSQL 16
    image: postgres:16-alpine   ← 軽量 Alpine Linux ベース
    ports: ["5434:5432"]        ← 外部はローカルホストのみ

  backend:     # FastAPI + Python
    build: ./backend            ← Dockerfile でビルド
    ports: ["8003:8003"]
    depends_on: [db]

  frontend:    # Nginx + React ビルド成果物
    build: ./frontend/vite-app  ← Vite でビルド → Nginx 配信
    ports: ["9080:80"]
    depends_on: [backend]
```

### 🏔️ Alpine Linux ベース

Docker イメージは全て Alpine Linux ベースを採用。

| 特徴 | 効果 |
|---|---|
| 最小構成 OS | イメージサイズ削減（ubuntu 比 1/10 以下） |
| セキュリティ | 攻撃面積最小化（不要パッケージ非搭載） |
| 高速起動 | コンテナ起動時間の短縮 |

### ⚙️ systemd user units

```
~/.config/systemd/user/
  ├── wmcdss.service              ← Docker Compose 起動（OS 起動連動）
  ├── wmcdss-jma-fetch.service    ← AMeDAS 取得ジョブ
  ├── wmcdss-jma-fetch.timer      ← 10 分ごとトリガー
  ├── wmcdss-jma-fetch-marine.service ← 波浪取得ジョブ
  └── wmcdss-jma-fetch-marine.timer   ← 1 時間ごとトリガー
```

**特徴**: `loginctl enable-linger` により、ログインなしでもタイマーが動作継続。

---

## 📡 気象データ取得

### 🌤️ 気象庁 API（JMA）

WMCDSS は気象庁が提供する公開 API を利用します。

| データ種別 | API エンドポイント（概要） | 更新頻度 | 取得間隔 |
|---|---|---|---|
| AMeDAS 観測データ | 気象庁 AMeDAS API | 10 分ごと | 10 分ごと |
| 波浪・海象データ | 気象庁 波浪予報 API | 1 時間ごと | 1 時間ごと |
| 天気予報 | 気象庁 天気予報 API | 随時 | 1 時間ごと |

```
気象庁 JMA API（外部）
       │
       ▼ HTTPS
┌─────────────────┐
│  Python 取得ジョブ │  ← httpx で非同期 HTTP リクエスト
│  ingest_jma.py  │
│  ingest_jma_    │
│  marine.py      │
└────────┬────────┘
         │ upsert（重複防止）
         ▼
   PostgreSQL DB
```

### 取得ジョブの信頼性設計

| 設計 | 詳細 |
|---|---|
| 冪等性（べきとうせい） | 同じデータを複数回取得しても重複しない（UPSERT） |
| エラー耐性 | タイムアウト・4xx/5xx は内部で吸収、監査ログに記録 |
| Persistent=true | OS が落ちていた間の分を再起動時に補填取得 |
| 独立失敗 | AMeDAS と波浪は別ジョブ — 片方の失敗が他方に波及しない |

---

## 🔐 認証・セキュリティ

### JWT（JSON Web Token）認証

```
ログイン要求
  │ POST /api/auth/login
  │ {email, password}
  ▼
パスワード検証（bcrypt ハッシュ比較）
  │
  ▼ 認証成功
JWT トークン発行
  ├── Header: アルゴリズム（HS256）
  ├── Payload: user_id, email, 有効期限
  └── Signature: JWT_SECRET で署名（PyJWT）

  ↓ フロントエンドは localStorage に保存
  ↓ 以降のリクエストに Authorization: Bearer <token>

API 側でトークン検証
  ├── 署名検証
  └── 有効期限チェック
```

> **ロール制御（RBAC）は未実装**: `users.role` カラムはスキーマ上存在するが未使用。全認証ユーザーが同等の権限を持つ。ロールベースの制御は将来課題。
```

### セキュリティ対策一覧

| 対策 | 実装方法 |
|---|---|
| パスワードハッシュ | bcrypt（ソルト付き） |
| 通信暗号化 | 社内 LAN 内。外部公開する場合は HTTPS 必須 |
| SQL インジェクション対策 | SQLAlchemy ORM（生 SQL を直接結合しない） |
| API キー認証 | mutation エンドポイントは `X-API-Key` 必須（`WMCDSS_API_KEYS`） |
| JWT 認証 | WebUI からのログインセッション（`WMCDSS_JWT_SECRET`） |
| 監査ログ | 全操作を audit_log テーブルに記録 |
| SECRET_KEY | `.env` ファイル管理（Git 管理対象外） |

> **ロールベースアクセス制御は未実装**。`users.role` カラムは存在するが、権限による API 制御は行われていない。将来の課題。

---

## 🔄 CI/CD・品質管理

### GitHub Actions

```
PR 作成・Push
  │
  ├── 🔷 Backend CI
  │     ├── ruff（Python Lint）
  │     ├── pytest（ユニットテスト）
  │     └── Docker build 確認
  │
  ├── ⚛️ Frontend CI
  │     ├── Vitest（ユニットテスト）
  │     ├── Vite build（型チェック含む）
  │     └── Playwright E2E テスト
  │
  └── ✅ 全 CI 通過 → merge 許可
```

### テスト構成

| レイヤー | ツール | 内容 |
|---|---|---|
| Python ユニットテスト | pytest | API エンドポイント・DB ロジック |
| TypeScript ユニットテスト | Vitest | コンポーネント・ユーティリティ関数 |
| E2E テスト | Playwright | ブラウザ自動操作・画面遷移確認 |
| Python Lint | ruff | PEP8 準拠・未使用インポート検出 |
| TypeScript Lint | （ESLint 未使用・Vite + TypeScript の型チェックで代替） |

### 🔍 コード品質ツール

| ツール | 用途 |
|---|---|
| ruff | Python 高速 Lint（flake8 + isort 代替） |
| Vitest | Vite ネイティブテストランナー（Jest 互換） |
| Playwright | クロスブラウザ E2E テスト |
| pytest | Python テストフレームワーク |

---

## 📊 バージョン一覧

| 技術・ライブラリ | バージョン | カテゴリ |
|---|---|---|
| Python | 3.11+ | バックエンド |
| FastAPI | 0.115+ | バックエンド |
| SQLAlchemy | 2.0+ | バックエンド |
| Pydantic | 2.10+ | バックエンド |
| uvicorn | 0.34+ | バックエンド |
| React | 19.2+ | フロントエンド |
| TypeScript | （Vite バンドル内蔵） | フロントエンド |
| Vite | 6.0+ | フロントエンド |
| Leaflet.js | CDN | フロントエンド |
| PostgreSQL | 16 | データベース |
| Docker Engine | 24.x+ | インフラ |
| Docker Compose | v2.x | インフラ |
| Nginx | 1.27+ | インフラ |
| Node.js | 22 LTS | ビルドツール |
| pytest | 8.x | テスト |
| Vitest | 3.x | テスト |
| Playwright | 1.x | E2E テスト |
| ruff | 0.9+ | 品質管理 |

---

## 📚 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [README（トップ）](../README.md) | システム概要（非エンジニア向け） |
| [IT 部門向けガイド](IT-STAFF.md) | 導入・運用・トラブルシューティング |
| [アーキテクチャ](ARCHITECTURE.md) | 設計思想・データフロー |
| [セキュリティ設計](SECURITY.md) | 認証・セキュリティ対策詳細 |
| [技術リファレンス](TECHNICAL.md) | API 仕様・開発環境構築 |
