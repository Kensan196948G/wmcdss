# 🌊 WMCDSS — Weather-Marine Construction Decision Support System

> 現場気象海象 自動集計・施工判断支援システム
>
> 気象庁 (JMA) の AMeDAS・波浪データを自動取得し、現場ごとの閾値判定に基づいて
> 「⛏️ 着手可」「⚠️ 警戒」「⛔ 中止」を提示するダッシュボード兼 API。

[![tests](https://img.shields.io/badge/tests-51%20unit%20%2B%209%20smoke-brightgreen)](#-テスト)
[![ci](https://img.shields.io/badge/CI-ruff%20%2B%20pytest-2088FF)](.github/workflows/ci.yml)
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
      B[FastAPI<br/>backend]
      D[(Postgres 16)]
    end
  end

  subgraph Client[ブラウザ]
    F[React<br/>frontend]
  end

  A1 --> T1
  A2 --> T2
  T1 -->|ingest_jma| B
  T2 -->|ingest_jma_marine| B
  B --> D
  F -->|HTTP /api/v1| B
  B -->|JSON| F

  classDef ext fill:#fff3cd,stroke:#856404
  classDef svc fill:#d4edda,stroke:#155724
  classDef cli fill:#cce5ff,stroke:#004085
  class A1,A2 ext
  class B,D,T svc
  class F cli
```

詳細は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を参照。

---

## 🧩 主要コンポーネント

| レイヤ | 技術 | パス | 役割 |
|---|---|---|---|
| 🖥️ Frontend | React (Babel Standalone) | `frontend/` | ダッシュボード・現場/閾値管理画面 |
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

### 環境変数（主なもの）

| 変数 | 既定 | 用途 |
|---|---|---|
| `WMCDSS_DATABASE_URL` | `postgresql+asyncpg://wmcdss:wmcdss@localhost:5432/wmcdss` | DB 接続 |
| `WMCDSS_API_KEYS` | （空＝認証無効） | カンマ区切りの API キー一覧 |
| `WMCDSS_CORS_ORIGINS` | 192.168.0.185:8888 等 | CORS 許可元 |
| `WMCDSS_JMA_USER_AGENT` | `wmcdss/0.1 (+contact: …)` | JMA への User-Agent |
| `WMCDSS_RATE_LIMIT_PER_MINUTE` | `0`（無効） | mutation の identity 単位 60-秒 sliding window cap |

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
| ユニット（auth middleware） | 9 | API Key 認証・exempt パス・タイミング攻撃耐性・非 ASCII 鍵拒否・過大鍵 DoS 防御 |
| ユニット（rate limit middleware） | 10 | sliding window・bucket 分離・window 期限切れ復活・exempt パス・identity hashing 漏洩防止 |
| ユニット（audit hardening） | 9 | actor_from の API Key 漏洩防止・write_audit strict モードの SQLAlchemyError 伝播 |
| ユニット（JMA AMeDAS fetcher） | 7 | パース・品質フラグ・block ロールバック・QC-drop 検出 |
| ユニット（JMA wave fetcher） | 9 | パース・grid snap・日跨ぎ fallback・5xx 伝播・sentinel 値除外・scalar/tuple 両対応 |
| ユニット（decisions など） | 7 | 判定ロジック・閾値マージ |
| API スモーク (要ライブ backend) | 9 | 起動中バックエンドに対する黒箱（audit 書込み契約を含む） |
| **合計** | **60** | ✅ unit 51/51 passing — smoke は `docker compose up` 環境で別実行 |

### 🤖 継続的インテグレーション

`push` / `pull_request` (→ `main`) で `.github/workflows/ci.yml` が **二段ジョブ**として起動：

| ジョブ | ステップ | 失敗時の影響 |
|---|---|---|
| `backend-unit` | `ruff check .` ／ `pytest --ignore=tests/test_api_smoke.py` | ❌ マージブロック |
| `backend-smoke` (`needs: backend-unit`) | `docker compose up -d --wait` ／ `/readyz` ポーリング ／ `pytest tests/test_api_smoke.py` (9 件) | ❌ マージブロック |

> 📝 unit を先に落とすことで、compose 起動 (〜90s) のコストを回帰の早期発見と引き換えに最小化。smoke は同じコマンドでローカルでも再現可能 (`docker compose exec backend pytest tests/test_api_smoke.py`)。

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
