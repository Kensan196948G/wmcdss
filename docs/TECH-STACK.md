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
│                             │  ・Leaflet マップ / Chart.js        │  │
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

### 🐍 Python 3.12

最新の安定版 Python を採用。型ヒントの強化、パフォーマンス改善、セキュリティパッチ対応が充実。

### ⚡ FastAPI

| 項目 | 詳細 |
|---|---|
| 役割 | REST API フレームワーク |
| 選定理由 | 型安全・自動ドキュメント生成・高パフォーマンス |
| 主要機能 | JWT 認証、ロール制御、リクエストバリデーション |
| ドキュメント | `/api/docs`（Swagger UI）で自動生成 |

```
GET  /api/v1/weather/current    ← 最新気象データ取得
GET  /api/v1/sites              ← 現場一覧
POST /api/v1/auth/login         ← ログイン（JWT 発行）
GET  /api/v1/construction/judge ← 施工判定
GET  /api/health                ← 死活監視
```

### 🔷 SQLAlchemy 2.x + Alembic

| ライブラリ | 役割 |
|---|---|
| SQLAlchemy | ORM（Python オブジェクト ↔ DB テーブル変換） |
| Alembic | DB スキーマバージョン管理・マイグレーション |
| asyncpg | 非同期 PostgreSQL ドライバ（高速処理） |

### 📦 主要 Python ライブラリ

| ライブラリ | バージョン | 用途 |
|---|---|---|
| `fastapi` | 0.115+ | API フレームワーク |
| `uvicorn` | 0.34+ | ASGI サーバ |
| `sqlalchemy` | 2.0+ | ORM |
| `alembic` | 1.14+ | DB マイグレーション |
| `pydantic` | 2.10+ | データバリデーション |
| `python-jose` | 3.3+ | JWT 生成・検証 |
| `passlib[bcrypt]` | 1.7+ | パスワードハッシュ |
| `httpx` | 0.28+ | JMA API 呼び出し |
| `aiofiles` | 24.x | 非同期ファイル I/O |

---

## 🖥️ フロントエンド（WebUI）

### ⚛️ React 18 + TypeScript 5

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

### 📊 Chart.js（グラフ・チャート）

| グラフ種別 | 用途 |
|---|---|
| 折れ線グラフ | 気温・風速の時系列変化 |
| 棒グラフ | 降水量・波高の日別比較 |
| 円グラフ | 現場別施工可否の割合 |

### 📦 主要 npm パッケージ

| パッケージ | バージョン | 用途 |
|---|---|---|
| `react` | 18.3+ | UI フレームワーク |
| `typescript` | 5.7+ | 型安全開発 |
| `vite` | 6.3+ | ビルドツール |
| `leaflet` | 1.9+ | 地図表示 |
| `chart.js` | 4.4+ | グラフ描画 |
| `react-leaflet` | 4.2+ | React 向け Leaflet ラッパー |
| `react-chartjs-2` | 5.3+ | React 向け Chart.js ラッパー |

---

## 🗄️ データベース

### 🐘 PostgreSQL 16

```
wmcdss データベース
  │
  ├── users（ユーザーテーブル）
  │     id / email / hashed_password / role / is_active / created_at
  │
  ├── weather_observations（気象観測データ）
  │     id / station_id / observed_at / temperature / wind_speed
  │     wind_direction / precipitation / humidity / pressure
  │
  ├── wave_observations（波浪観測データ）
  │     id / area_code / observed_at / wave_height / wave_period
  │     wave_direction / current_speed
  │
  ├── construction_sites（現場テーブル）
  │     id / name / lat / lng / area / station_id / thresholds
  │
  └── audit_log（監査ログ）
        id / user_email / action / resource / timestamp / ip_address
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
  ├── Payload: user_id, email, role, 有効期限
  └── Signature: SECRET_KEY で署名

  ↓ フロントエンドは localStorage に保存
  ↓ 以降のリクエストに Authorization: Bearer <token>

API 側でトークン検証
  ├── 署名検証
  ├── 有効期限チェック
  └── ロール確認（閲覧者/施工判定者/管理者）
```

### セキュリティ対策一覧

| 対策 | 実装方法 |
|---|---|
| パスワードハッシュ | bcrypt（ソルト付き） |
| 通信暗号化 | 社内 LAN 内。外部公開する場合は HTTPS 必須 |
| SQL インジェクション対策 | SQLAlchemy ORM（生 SQL を直接結合しない） |
| ロールベースアクセス制御 | FastAPI Depends による API レベル制御 |
| 監査ログ | 全操作を audit_log テーブルに記録 |
| SECRET_KEY | `.env` ファイル管理（Git 管理対象外） |

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
  │     ├── ESLint（TypeScript Lint）
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
| TypeScript Lint | ESLint | 型エラー・コードスタイル |

### 🔍 コード品質ツール

| ツール | 用途 |
|---|---|
| ruff | Python 高速 Lint（flake8 + isort 代替） |
| ESLint | TypeScript/JavaScript Lint |
| Vitest | Vite ネイティブテストランナー（Jest 互換） |
| Playwright | クロスブラウザ E2E テスト |
| pytest | Python テストフレームワーク |

---

## 📊 バージョン一覧

| 技術・ライブラリ | バージョン | カテゴリ |
|---|---|---|
| Python | 3.12 | バックエンド |
| FastAPI | 0.115+ | バックエンド |
| SQLAlchemy | 2.0+ | バックエンド |
| Alembic | 1.14+ | バックエンド |
| Pydantic | 2.10+ | バックエンド |
| uvicorn | 0.34+ | バックエンド |
| React | 18.3+ | フロントエンド |
| TypeScript | 5.7+ | フロントエンド |
| Vite | 6.3+ | フロントエンド |
| Leaflet.js | 1.9+ | フロントエンド |
| Chart.js | 4.4+ | フロントエンド |
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
