# 🛠️ IT 部門向け 導入・運用ガイド

> **対象読者**: 社内 IT 部門スタッフ、インフラ担当者
> このドキュメントは WMCDSS の導入・日常運用に必要な技術情報をまとめています。

---

## 📋 目次

1. [システム全体像](#-システム全体像)
2. [動作環境・前提条件](#-動作環境前提条件)
3. [初回セットアップ](#-初回セットアップ)
4. [OS 起動時の自動起動 (systemd)](#-os-起動時の自動起動-systemd)
5. [日常運用・監視](#-日常運用監視)
6. [バックアップ](#-バックアップ)
7. [ユーザー管理](#-ユーザー管理)
8. [ログの確認方法](#-ログの確認方法)
9. [トラブルシューティング](#-トラブルシューティング)
10. [アクセス URL まとめ](#-アクセス-url-まとめ)

---

## 🗺️ システム全体像

```
┌─────────────────────────────────────────────────────────────────┐
│  社内 LAN                                                        │
│                                                                  │
│   ブラウザ端末 ─────────── ポート 9080 ─────── 🖥️ WebUI          │
│  （PC・スマホ）                                 （Nginx / React）│
│                                                      │          │
│                              Docker 内部 ────── ⚙️ API サーバ   │
│                                                 （FastAPI）      │
│                                                      │          │
│                                                 🗄️ DB           │
│                                                 （PostgreSQL）   │
│                                                 Docker 内部      │
│                                                      │          │
│                        cron（10分/1時間）─── 📡 気象データ取得   │
│                                                 （JMA API）      │
└─────────────────────────────────────────────────────────────────┘

  ※ WebUI・API・DB は Docker Compose で一体管理
  ※ 本番では API・DB の外部ポートは公開せず、WebUI の nginx 経由で API に接続
```

---

## 💻 動作環境・前提条件

| 項目 | 要件 |
|---|---|
| OS | Linux（Ubuntu 22.04 LTS 推奨） |
| CPU | 2 コア以上 |
| メモリ | 4 GB 以上（8 GB 推奨） |
| ディスク | 20 GB 以上の空き容量 |
| ネットワーク | 社内 LAN + インターネット接続（JMA API へのアクセス必須） |
| Docker | Docker Engine 24.x 以上、Docker Compose Plugin v2 |
| Git | インストール済み |

### 必要なソフトウェアのインストール（Ubuntu の場合）

```bash
# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# ← ログアウト・再ログインが必要

# 確認
docker --version        # Docker version 24.x.x 以上
docker compose version  # Docker Compose version v2.x.x 以上
```

---

## 🚀 初回セットアップ

```bash
# 1. リポジトリを取得
git clone https://github.com/<org>/Weather-Marine-Construction-Decision-Support-System.git \
    ~/Projects/Weather-Marine-Construction-Decision-Support-System
cd ~/Projects/Weather-Marine-Construction-Decision-Support-System

# 2. 本番環境変数ファイルを作成（テンプレートから）
cp .env.production.example .env.production
# → .env.production を編集:
#   POSTGRES_PASSWORD / WMCDSS_API_KEYS_RAW / WMCDSS_JWT_SECRET は必ず変更する

# 3. 本番サービスを起動
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build

# 4. 起動確認（全コンテナが healthy/running になるまで待つ）
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

**起動後の確認:**

| 確認項目 | コマンド・URL |
|---|---|
| WebUI が開く | ブラウザで `http://<サーバIP>:9080` |
| API が応答する | ブラウザで `http://<サーバIP>:9080/readyz` |
| コンテナ状態 | `docker compose --env-file .env.production -f docker-compose.production.yml ps` |
| ログ確認 | `docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend` |

> サーバの IP アドレスは `ip addr show` コマンドで確認できます。

---

## ⚙️ OS 起動時の自動起動 (systemd)

サーバ再起動後も WMCDSS が自動で起動するように設定します。

### メインサービス（WebUI + API + DB）

```bash
mkdir -p ~/.config/systemd/user
cp ~/Projects/Weather-Marine-Construction-Decision-Support-System/deploy/systemd/wmcdss.service \
   ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now wmcdss.service
sudo loginctl enable-linger $USER   # ← ログインなしでも起動するために必要
```

### 気象データ自動取得タイマー（AMeDAS）

```bash
# AMeDAS（10分ごと）と 波浪データ（1時間ごと）の2タイマーをコピー
cp deploy/systemd/wmcdss-jma-fetch.service      ~/.config/systemd/user/
cp deploy/systemd/wmcdss-jma-fetch.timer        ~/.config/systemd/user/
cp deploy/systemd/wmcdss-jma-fetch-marine.service ~/.config/systemd/user/
cp deploy/systemd/wmcdss-jma-fetch-marine.timer   ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now wmcdss-jma-fetch.timer
systemctl --user enable --now wmcdss-jma-fetch-marine.timer
```

### 自動起動の確認

```bash
# サービス状態
systemctl --user status wmcdss.service
systemctl --user status wmcdss-jma-fetch.timer
systemctl --user status wmcdss-jma-fetch-marine.timer

# タイマー一覧（次回実行時刻も確認できる）
systemctl --user list-timers 'wmcdss-jma-fetch*'
```

---

## 📊 日常運用・監視

### コンテナ状態確認

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
# 全コンテナが Up かつ (healthy) または running であること
```

### ログ確認

```bash
# API サーバのログ（リアルタイム）
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend

# WebUI（Nginx）のログ
docker compose --env-file .env.production -f docker-compose.production.yml logs -f frontend

# 全サービスのログ
docker compose --env-file .env.production -f docker-compose.production.yml logs -f
```

### 気象データ取得の確認

```bash
# AMeDAS 取得ジョブのログ
journalctl --user -u wmcdss-jma-fetch.service -n 50

# 波浪データ取得ジョブのログ
journalctl --user -u wmcdss-jma-fetch-marine.service -n 50
```

### 手動でデータ取得を実行（テスト・確認用）

```bash
# AMeDAS
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend python -m app.jobs.ingest_jma

# 波浪データ
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend python -m app.jobs.ingest_jma_marine
```

---

## 💾 バックアップ

### DB バックアップ（PostgreSQL）

```bash
# バックアップを取得
docker compose --env-file .env.production -f docker-compose.production.yml exec db pg_dump -U wmcdss_app wmcdss \
  | gzip > backup_$(date +%Y%m%d).sql.gz

# 復元
gunzip -c backup_20260614.sql.gz \
  | docker compose --env-file .env.production -f docker-compose.production.yml exec -T db psql -U wmcdss_app wmcdss
```

**推奨**: cron で毎日自動バックアップを設定し、世代管理（30 日分）することを推奨します。

---

## 👤 ユーザー管理

初期管理者アカウントは `.env` ファイルの `ADMIN_EMAIL` / `ADMIN_PASSWORD` で設定します。

ユーザーの追加・削除・権限変更は WebUI の「設定 → ユーザー管理」画面から行います。
操作はすべて監査ログに記録されます。

| 権限レベル | 操作可能な範囲 |
|---|---|
| 閲覧者 | データ閲覧・レポート出力のみ |
| 施工判定者 | 施工判定の実行・しきい値の参照 |
| 管理者 | すべての操作 + ユーザー管理・しきい値変更 |

---

## 📄 ログの確認方法

### システムログ（API アクセス・エラー）

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs backend --since 1h
```

### 監査ログ（誰が・何を操作したか）

WebUI の「設定 → 監査ログ」画面で確認できます。CSV 形式でエクスポートも可能です。

### ログのローテーション

Docker のログは自動でローテーションされます。デフォルトは 10MB × 3 世代。
`docker-compose.production.yml` の `logging:` セクションで変更可能です。

---

## 🔧 トラブルシューティング

### WebUI が開かない

```bash
# コンテナが起動しているか確認
docker compose --env-file .env.production -f docker-compose.production.yml ps

# ポートが使用中でないか確認
sudo ss -tlnp | grep ':9080'

# コンテナを再起動
docker compose --env-file .env.production -f docker-compose.production.yml restart frontend
```

### 気象データが更新されない

```bash
# タイマーが有効か確認
systemctl --user list-timers 'wmcdss-jma-fetch*'

# 最後の取得ログを確認
journalctl --user -u wmcdss-jma-fetch.service -n 20

# 手動で実行してエラーを確認
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend python -m app.jobs.ingest_jma
```

### DB 接続エラー

```bash
# DB コンテナの状態確認
docker compose --env-file .env.production -f docker-compose.production.yml ps db

# DB のログ確認
docker compose --env-file .env.production -f docker-compose.production.yml logs db --tail 50

# DB に直接接続して確認
docker compose --env-file .env.production -f docker-compose.production.yml exec db psql -U wmcdss_app wmcdss
```

---

## 🌐 アクセス URL まとめ

| サービス | URL | 用途 |
|---|---|---|
| 🖥️ WebUI | `http://<サーバIP>:9080` | 通常業務での利用 |
| ⚙️ API | `http://<サーバIP>:9080/api/v1` | WebUI nginx 経由で利用 |
| 📋 API ドキュメント | 本番では非公開 | `WMCDSS_EXPOSE_OPENAPI=false` |
| 🩺 ヘルスチェック | `http://<サーバIP>:9080/readyz` | 監視ツールからの死活監視に使用 |

> サーバ IP は `ip addr show` コマンドで確認してください。
> 社内ファイアウォールでポート 9080 を社内 LAN 向けに開放してください（外部公開不要）。

---

## 📚 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [README（トップ）](../README.md) | システム概要（非エンジニア向け） |
| [技術スタック](TECH-STACK.md) | 使用技術・ライブラリの詳細 |
| [アーキテクチャ](ARCHITECTURE.md) | 設計思想・データフロー |
| [セキュリティ設計](SECURITY.md) | 認証・セキュリティ対策 |
| [技術リファレンス](TECHNICAL.md) | API 仕様・開発環境構築 |
