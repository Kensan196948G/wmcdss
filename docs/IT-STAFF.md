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
# 1. リポジトリを取得（配置先はどこでもよい。以降 $WMCDSS_HOME で参照する）
git clone https://github.com/Kensan196948G/wmcdss.git ~/Projects/wmcdss
cd ~/Projects/wmcdss

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
| DB スキーマ適用 | `docker compose --env-file .env.production -f docker-compose.production.yml logs db-migrate` |
| ログ確認 | `docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend` |

> サーバの IP アドレスは `ip addr show` コマンドで確認できます。

**`db-migrate` について:** DB のスキーマ適用専用の使い捨てコンテナです。
`backend` より先に必ず実行され、成功（`Exited (0)`）しない限り `backend` も
気象取得も起動しません。「デプロイは成功したのにスキーマだけ古い」状態を
作らないための仕組みなので、`ps` で `Exited (0)` になっているのが正常です。
ログには次のように出ます。

```
検出: 2 件 / 適用済み: 0 件 / 未適用: 2 件
適用: 0001_init.sql
適用: 0002_seed_demo.sql
完了
```

2 回目以降の起動では `適用対象なし` と出ます（何度実行しても安全です）。
更新版を配布したときだけ、新しいファイルが `適用:` として流れます。

---

## ⚙️ OS 起動時の自動起動 (systemd)

サーバ再起動後も WMCDSS が自動で起動するように設定します。

### メインサービス（WebUI + API + DB）

systemd の unit ファイルにはリポジトリのパスを書きません。
`~/.config/wmcdss/deploy.env` の `WMCDSS_HOME` 1 箇所だけで位置を決めます。
このファイルが無いと unit は起動せず `Failed to load environment files` で止まります
（黙って動いたふりをするより、明示的に止める方を選んでいます）。

```bash
# 0. チェックアウト位置を登録（初回のみ）
mkdir -p ~/.config/wmcdss
cp deploy/systemd/deploy.env.example ~/.config/wmcdss/deploy.env
${EDITOR:-nano} ~/.config/wmcdss/deploy.env   # WMCDSS_HOME を絶対パスへ書き換える
#   例: WMCDSS_HOME=/home/youruser/Projects/wmcdss
#   secret は書かないこと。ここはパスだけ、秘密情報は .env.production 側。

mkdir -p ~/.config/systemd/user
cp deploy/systemd/wmcdss.service ~/.config/systemd/user/

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

### ⚠️ 更新版を適用する前は必ずバックアップを取る

新しいバージョンには DB スキーマの変更（migration）が含まれることがあります。
**スキーマを元に戻す自動手段は用意していません**（自動生成した逆操作は
`DROP COLUMN` などでデータを失う経路を常に抱えるため）。上記の `pg_dump` が
唯一の復旧地点になります。

```bash
# 1. バックアップ（復旧地点）
docker compose --env-file .env.production -f docker-compose.production.yml exec db \
  pg_dump -U wmcdss_app wmcdss | gzip > backup_$(date +%Y%m%d_%H%M).sql.gz

# 2. 更新版を取得して起動（db-migrate が自動でスキーマを適用する）
git pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

問題が起きた場合の戻し方は、**アプリと DB の両方**を同じ時点へ戻します。

```bash
# 書き込みを止める
docker compose --env-file .env.production -f docker-compose.production.yml \
  stop backend weather-ingest marine-ingest

# DB を復元（適用記録もダンプに含まれるため、その時点の状態ごと戻る）
gunzip -c backup_YYYYMMDD_HHMM.sql.gz | docker compose --env-file .env.production \
  -f docker-compose.production.yml exec -T db psql -U wmcdss_app wmcdss

# アプリも同じ時点へ戻してから起動
git checkout <戻したい commit>
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

---

## 👤 ユーザー管理

ユーザーは環境変数 `WMCDSS_LOCAL_USERS` で静的に定義します。
`username:bcrypt_hash` 形式のエントリをカンマ区切りで並べます。

```bash
# .env.production の設定例
WMCDSS_LOCAL_USERS=admin:$2b$12$...,user1:$2b$12$...
```

bcrypt ハッシュの生成:

```bash
# backend コンテナの Python で生成
docker compose exec backend python -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"
```

ユーザーの追加・削除は `.env.production` を編集し、`docker compose restart backend` で反映します。
WebUI からユーザーを管理する画面は**存在しません**。操作はすべて監査ログに記録されます。

| 権限レベル | 操作可能な範囲 |
|---|---|
| 全認証ユーザー | すべての操作（現状は同等） |

> **ロールベースアクセス制御（RBAC）は未実装**: `users.role` カラムはスキーマ上存在しますが、権限による機能制限は行われていません。全ユーザーが同等の権限を持ちます。ロール制御は将来の課題です。

---

## 📄 ログの確認方法

### システムログ（API アクセス・エラー）

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs backend --since 1h
```

### 監査ログ（誰が・何を操作したか）

WebUI の「設定 → 監査ログ」画面で確認できます。CSV エクスポート機能は未実装です。

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

### backend が起動しない（`db-migrate` が失敗している）

`backend` は `db-migrate` の成功を待つため、スキーマ適用に失敗すると
`backend` は `Created` のまま起動しません。まず原因をログで確認します。

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs db-migrate
```

**ケース 1: 「DB にスキーマが存在するのに migration の適用記録が無い」**

このバージョンを導入する**前から動いていた DB** で一度だけ起きます。旧方式では
適用記録を残していなかったため、記録を作り直す必要があります。

```bash
# 現在のバックアップを取ってから実行すること（下記「バックアップ」参照）
docker compose --env-file .env.production -f docker-compose.production.yml \
  run --rm db-migrate python -m app.db.migrate baseline

# → baseline: 0001_init.sql を適用済みとして記録（SQL は実行していない）

# 記録できたら通常どおり起動
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

これはデータを変更しません（記録を書くだけで SQL は実行しません）。
一度実行すれば以後は不要です。

**ケース 2: 「適用済み migration の内容が変更されている」**

配布ファイルが書き換わっています。安全のため停止しています。チェックアウトを
正規の状態に戻してください（`git status` で差分を確認）。判断に迷う場合は
自己判断で先へ進めず、開発元へログを添えて連絡してください。

**ケース 3: 「migration ファイルが 1 件も無い」「ディレクトリが存在しない」**

リポジトリの配置場所から `docker compose` を実行していない可能性があります。
`$WMCDSS_HOME` に移動してから起動し直してください。

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
