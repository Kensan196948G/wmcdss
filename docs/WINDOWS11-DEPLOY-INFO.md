# WMCDSS — Windows 11 ネイティブ展開情報

> 作成日: 2026-06-05 | 対象: WMCDSS (Weather-Marine Construction Decision Support System)
> Windows 11 Pro 上の Docker Desktop を利用したオンプレミス展開ガイド

---

## 📋 目次

1. [展開サーバー情報](#1-展開サーバー情報)
2. [ネットワーク情報](#2-ネットワーク情報)
3. [外部連携情報](#3-外部連携情報)
4. [必要ソフトウェア](#4-必要ソフトウェア)
5. [ポート割り当て](#5-ポート割り当て)
6. [WebUI アクセス情報](#6-webui-アクセス情報)
7. [認証情報管理](#7-認証情報管理)
8. [Docker 自動起動設定](#8-docker-自動起動設定)
9. [展開前チェックリスト](#9-展開前チェックリスト)
10. [展開手順](#10-展開手順)

---

## 1. 展開サーバー情報

| 項目 | 値 |
|------|----|
| **展開ホスト OS** | Windows 11 Pro (10.0.26200) |
| **ホスト名** | 展開先 PC / サーバー |
| **プライマリ IP** | `172.23.10.251` |
| **サブネットマスク** | `255.255.0.0` (`/16`) |
| **デフォルトゲートウェイ** | `172.23.254.254` |
| **DNS ドメイン** | `mirai.local` |
| **AD ドメイン** | `mirai.local` |
| **AD コントローラー** | VMSV3001 |
| **ファイルサーバー** | GMSV0002 |
| **メール/M365 ドメイン** | `@mirai-const.co.jp` |

### 関連サーバー

| ホスト名 | 役割 | 認証情報参照 |
|----------|------|-------------|
| `VMSV3001` | AD ドメインコントローラー | `cert/ADEntraIDCert.txt` |
| `GMSV0002` | ファイルサーバー（機器台帳格納） | `cert/GMSV0002.txt` |

> ⚠️ サーバー認証情報は `cert/` フォルダの各 `.txt` ファイルを参照してください。ソースコードへの直接記載は禁止です。

---

## 2. ネットワーク情報

### ネットワークセグメント

| セグメント | 用途 | 例 |
|-----------|------|-----|
| `172.23.0.0/16` | 社内 LAN（主要） | 172.23.10.x, 172.23.11.x |
| `10.212.134.0/24` | 社内 LAN（サブ） | 10.212.134.x |
| `192.168.210.0/24` | テレワーク VPN | 192.168.210.x |
| `172.21.144.0/20` | Docker Default Switch | 172.21.144.x |
| `172.24.128.0/20` | WSL (Hyper-V) | 172.24.128.x |

### Docker ネットワーク

| ネットワーク名 | ゲートウェイ | 用途 |
|----------------|-------------|------|
| vEthernet (Default Switch) | 172.21.144.1 | Docker コンテナ |
| vEthernet (WSL) | 172.24.128.1 | WSL 統合 |

### ファイアウォール / 開放ポート

WMCDSS 展開に必要な Windows Defender ファイアウォール 受信規則:

```powershell
# WebUI (フロントエンド)
netsh advfirewall firewall add rule name="WMCDSS-WebUI" protocol=TCP dir=in localport=9080 action=allow

# バックエンド API (内部用)
netsh advfirewall firewall add rule name="WMCDSS-API" protocol=TCP dir=in localport=8003 action=allow
```

---

## 3. 外部連携情報

### Microsoft 365 / Entra ID (Azure AD)

| 項目 | 値 | 用途 |
|------|-----|------|
| **テナント ID** | `a7232f7a-a9e5-4f71-9372-dc8b1c6645ea` | M365 認証 |
| **クライアント ID** | `22e5d6e4-805f-4516-af09-ff09c7c224c4` | アプリ登録 |
| **クライアントシークレット** | `cert/ADEntraIDCert.txt` 参照 | M365 非対話式認証 |
| **認証エンドポイント** | `https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token` | ROPC フロー |
| **Graph API** | `https://graph.microsoft.com/v1.0/me` | ユーザー情報取得 |
| **スコープ** | `https://graph.microsoft.com/User.Read` | プロフィール読取 |
| **対象ユーザードメイン** | `@mirai-const.co.jp` | 対象ドメイン 全社員 |

### Active Directory (AD)

| 項目 | 値 |
|------|-----|
| **ドメイン** | `mirai.local` |
| **ドメインコントローラー** | VMSV3001 |
| **LDAP ポート** | 389 (LDAP) / 636 (LDAPS) |
| **管理者アカウント** | `cert/ADEntraIDCert.txt` 参照 |

### 気象庁 (JMA) API

| 項目 | 値 |
|------|-----|
| **AMeDAS エンドポイント** | `https://www.jma.go.jp/bosai/amedas/` |
| **波浪ナウキャスト** | `https://www.jma.go.jp/bosai/nowc/` |
| **取得間隔** | 10分 (AMeDAS) / 1時間 (波浪) |
| **User-Agent** | `wmcdss/1.0 (+contact: kensan1969@gmail.com)` |

### DeskNet's NEO (社員情報)

| 項目 | 値 |
|------|-----|
| **ログイン** | `cert/desknetsneologin-info.txt` 参照 |
| **ユーザー数** | 約 533名 |
| **データパス** | `CMDB/DeskNetSNeo-Files/desknet_users.csv` |
| **更新頻度** | 毎日 08:30 自動更新 |

---

## 4. 必要ソフトウェア

### 必須

| ソフトウェア | バージョン | 用途 |
|-------------|-----------|------|
| Docker Desktop for Windows | 4.x 以上 | コンテナ実行環境 |
| Git | 2.x 以上 | ソース管理 |

### Docker Desktop 設定

1. **Settings → General → Start Docker Desktop when you sign in** → ✅ ON
2. **Settings → General → Use Docker Compose V2** → ✅ ON
3. **Settings → Resources → Memory** → 4GB 以上推奨
4. **Settings → Resources → CPU** → 2コア以上推奨

### オプション

| ソフトウェア | 用途 |
|-------------|------|
| Windows Subsystem for Linux (WSL2) | Docker バックエンド（推奨） |
| PowerShell 7+ | 管理スクリプト実行 |

---

## 5. ポート割り当て

### WMCDSS 使用ポート

| サービス | ホストポート | コンテナポート | プロトコル | 外部公開 |
|---------|------------|----------------|---------|---------|
| **Frontend (nginx)** | **9080** | 80 | HTTP | ✅ はい |
| Backend (FastAPI) | 8003 | 8000 | HTTP | 内部のみ |
| Database (PostgreSQL) | 127.0.0.1:5434 | 5432 | TCP | ❌ ローカルのみ |

### ホスト上で使用中のポート（競合注意）

| ポート | 用途 | 備考 |
|--------|------|------|
| 80 | IIS / システム | 使用禁止 |
| 3000 | 既存アプリ | 使用禁止 |
| 5174 | 既存アプリ | 使用禁止 |
| 5432 | 既存 PostgreSQL | 使用禁止 |
| 8000 | 既存アプリ | 使用禁止 |
| 8080, 8081, 8082 | 既存 Docker サービス | 使用禁止 |
| 18000, 18080 | 既存 Docker サービス | 使用禁止 |
| 9080 | **WMCDSS WebUI** | ✅ 割り当て済み |
| 8003 | **WMCDSS Backend** | ✅ 割り当て済み |

---

## 6. WebUI アクセス情報

### アクセス URL

```
http://172.23.10.251:9080
```

> 社内 LAN (172.23.0.0/16) から上記 URL でアクセス可能です。

### ログイン方法

| 方法 | 説明 |
|------|------|
| **一般ログイン** | ローカルアカウント（ユーザー名 / パスワード）でログイン |
| **Microsoft 365 ログイン** | `@mirai-const.co.jp` のメールアドレス + M365 パスワードでログイン（非対話式） |

---

## 7. 認証情報管理

### ルール

- ✅ 認証情報は `.env.windows` ファイルに格納（`.gitignore` 対象）
- ❌ `cert/*.txt` の内容をソースコードに直接記載しない
- ❌ `.env.windows` を git commit しない

### .env.windows ファイルの作成

```powershell
# プロジェクトルートで実行
Copy-Item .env.windows.example .env.windows
# エディタで実際の値を入力
notepad .env.windows
```

必要な設定値は `cert/ADEntraIDCert.txt` を参照:

| 環境変数名 | 説明 | 参照元 |
|-----------|------|--------|
| `WMCDSS_ENTRA_TENANT_ID` | Entra ID テナント ID | `cert/ADEntraIDCert.txt` |
| `WMCDSS_ENTRA_CLIENT_ID` | アプリ クライアント ID | `cert/ADEntraIDCert.txt` |
| `WMCDSS_ENTRA_CLIENT_SECRET` | クライアントシークレット | `cert/ADEntraIDCert.txt` |
| `WMCDSS_JWT_SECRET` | JWT 署名秘密鍵（任意の長い文字列） | 自動生成 |
| `WMCDSS_LOCAL_ADMIN_PASSWORD` | ローカル管理者パスワード | 任意設定 |

---

## 8. Docker 自動起動設定

### Docker Desktop 自動起動

1. **スタートアップ登録**:
   - Docker Desktop → Settings → General → **"Start Docker Desktop when you sign in"** を ON

2. **コンテナ自動起動** (`restart: always` 設定済み):
   - Docker Desktop 起動 → `wmcdss-db`, `wmcdss-backend`, `wmcdss-frontend` が自動起動

3. **Windows サービスとして登録** (オプション):

```powershell
# WMCDSS を Windows サービスとして登録（要管理者権限）
# Docker Desktop が起動している状態で実行

$serviceName = "WMCDSS"
$projectPath = "D:\wmcdss"
$action = New-ScheduledTaskAction -Execute "docker" -Argument "compose up -d" -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName $serviceName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
```

---

## 9. 展開前チェックリスト

### インフラ確認

- [ ] Docker Desktop がインストール済み
- [ ] Docker Desktop が起動している
- [ ] ポート 9080, 8003 が空き状態
- [ ] プロジェクトディレクトリが `D:\wmcdss` に存在

### 設定ファイル確認

- [ ] `.env.windows` が作成済み（`.env.windows.example` からコピー）
- [ ] `WMCDSS_ENTRA_TENANT_ID` が設定済み
- [ ] `WMCDSS_ENTRA_CLIENT_ID` が設定済み
- [ ] `WMCDSS_ENTRA_CLIENT_SECRET` が設定済み
- [ ] `WMCDSS_JWT_SECRET` が設定済み（32文字以上推奨）

### ネットワーク確認

- [ ] ホスト IP が `172.23.10.251` であること（`ipconfig` で確認）
- [ ] ゲートウェイ `172.23.254.254` に到達可能
- [ ] インターネット（JMA API 接続）に到達可能: `Test-NetConnection www.jma.go.jp -Port 443`
- [ ] Entra ID に到達可能: `Test-NetConnection login.microsoftonline.com -Port 443`

### ファイアウォール確認

- [ ] ポート 9080 受信許可ルール追加済み
- [ ] ポート 8003 受信許可ルール追加済み（API 直接アクセスが必要な場合）

---

## 10. 展開手順

```powershell
# 1. プロジェクトルートに移動
Set-Location D:\wmcdss

# 2. 環境変数ファイル準備
Copy-Item .env.windows.example .env.windows
# cert/ADEntraIDCert.txt の値を .env.windows に設定

# 3. ファイアウォール設定（要管理者権限）
netsh advfirewall firewall add rule name="WMCDSS-WebUI" protocol=TCP dir=in localport=9080 action=allow
netsh advfirewall firewall add rule name="WMCDSS-API" protocol=TCP dir=in localport=8003 action=allow

# 4. Docker イメージビルドとサービス起動
docker compose --env-file .env.windows up -d --build

# 5. 起動確認（全コンテナが "healthy" になるまで待機）
docker compose ps

# 6. ヘルスチェック
Invoke-WebRequest http://172.23.10.251:8003/healthz
Invoke-WebRequest http://172.23.10.251:9080

# 7. WebUI アクセス確認
Start-Process "http://172.23.10.251:9080"
```

### 停止・再起動

```powershell
# 停止
docker compose down

# 再起動（ログ保持）
docker compose restart

# フルリビルド
docker compose down && docker compose --env-file .env.windows up -d --build
```

---

*最終更新: 2026-06-05 | 担当: WMCDSS 運用チーム*
