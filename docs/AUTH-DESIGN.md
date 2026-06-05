# WMCDSS — 認証設計書

> 作成日: 2026-06-05 | バージョン: 1.0

---

## 概要

WMCDSS は **2種類の認証方式** をサポートする:

| 方式 | 対象ユーザー | 技術 |
|------|------------|------|
| **一般ログイン** | ローカル管理者アカウント | JWT (HS256) |
| **Microsoft 365 ログイン** | `@mirai-const.co.jp` 社員 | M365 ROPC + JWT |

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────────┐
│  Browser  (http://172.23.10.251:9080)                │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  LoginPage (auth.tsx)                        │    │
│  │   ├── [一般ログイン] user/pass → POST /api/v1/auth/login         │
│  │   └── [M365ログイン] email/pass → POST /api/v1/auth/login/m365  │
│  └─────────────────────────────────────────────┘    │
│           ↓ JWT (access_token)                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  AppShell / Dashboard (既存 WebUI)           │    │
│  │  Authorization: Bearer <JWT>                 │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                       ↕ HTTP
┌──────────────────────────────────────────────────────┐
│  Backend (FastAPI)  :8003                            │
│                                                      │
│  POST /api/v1/auth/login                             │
│    → 環境変数のハッシュと比較 → JWT 発行             │
│                                                      │
│  POST /api/v1/auth/login/m365                        │
│    → MSAL ROPC → Entra ID → Graph API検証 → JWT発行 │
│                                                      │
│  GET  /api/v1/auth/me                                │
│    → JWT 検証 → ユーザー情報返却                     │
│                                                      │
│  JWTAuthMiddleware (既存 APIKeyMiddleware と共存)     │
│    → Bearer トークン検証 → 未認証なら 401            │
└──────────────────────────────────────────────────────┘
                       ↕
┌──────────────────────────────────────────────────────┐
│  Microsoft Entra ID (Azure AD)                       │
│  Tenant: a7232f7a-a9e5-4f71-9372-dc8b1c6645ea       │
│  ROPC endpoint:                                      │
│  POST /oauth2/v2.0/token (grant_type=password)       │
└──────────────────────────────────────────────────────┘
```

---

## 1. 一般ログイン (Local Auth)

### フロー

```
1. ユーザー → LoginPage に username / password を入力
2. POST /api/v1/auth/login {"username": "...", "password": "..."}
3. Backend: bcrypt でハッシュ比較 (環境変数 WMCDSS_LOCAL_USERS)
4. 一致 → JWT 生成 (有効期限: 8時間)
5. Frontend: JWT を localStorage に保存
6. 以降の API リクエスト: Authorization: Bearer <JWT>
```

### ローカルユーザー設定

`.env.windows` に以下の形式で設定:

```env
# username:bcrypt_hash 形式、カンマ区切り
WMCDSS_LOCAL_USERS=admin:$2b$12$xxxxx,operator:$2b$12$yyyyy
```

ハッシュ生成コマンド:
```powershell
docker run --rm python:3.11 python -c "import bcrypt; print(bcrypt.hashpw(b'password', bcrypt.gensalt()).decode())"
```

---

## 2. Microsoft 365 ログイン (M365 ROPC 非対話式)

### 方式: Resource Owner Password Credentials (ROPC)

ROPC は **非対話式** 認証フロー。ユーザーはブラウザリダイレクトなしに WMCDSS ログイン画面へ直接 M365 資格情報を入力する。

> **なぜ ROPC か**: 対話式（Authorization Code Flow）は ブラウザポップアップ/リダイレクトが必要。ROPC はクライアントアプリがサーバーサイドで Entra ID と直接通信するため、エンドユーザーには M365 ログイン画面が表示されない（非対話式）。

### フロー

```
1. ユーザー → LoginPage に M365 メールアドレス + パスワードを入力
2. POST /api/v1/auth/login/m365 {"email": "...", "password": "..."}
3. Backend (MSAL):
   a. POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token
      grant_type=password
      client_id={client_id}
      client_secret={client_secret}
      username={email}
      password={password}
      scope=https://graph.microsoft.com/User.Read
   b. → Entra ID がアクセストークンを返却
4. Backend: GET https://graph.microsoft.com/v1.0/me
   Authorization: Bearer {entra_access_token}
   → ユーザー情報取得・確認 (email, displayName)
5. Backend: WMCDSS 用 JWT を生成
6. Frontend: JWT を localStorage に保存
```

### 必要な Azure アプリ登録設定

Entra ID アプリ登録 (Client ID: `22e5d6e4-805f-4516-af09-ff09c7c224c4`) に以下が必要:

- [x] **API アクセス許可**: `User.Read` (Microsoft Graph, 委任)
- [x] **Allow public client flows**: Enabled (ROPC に必須)
- [x] **サポートされるアカウントの種類**: 組織のディレクトリ内のアカウントのみ

Azure ポータル確認手順:
```
Azure Portal → Entra ID → アプリの登録 → wmcdss
→ 認証 → 詳細設定 → パブリック クライアント フローを許可 → はい
→ API のアクセス許可 → Microsoft Graph → User.Read → 委任済みアクセス許可
```

---

## 3. JWT 仕様

| 項目 | 値 |
|------|-----|
| アルゴリズム | HS256 |
| 有効期限 | 480分 (8時間) |
| 署名キー | `WMCDSS_JWT_SECRET` 環境変数 |
| クレーム | `sub` (ユーザー名/メール), `auth_type` (local/m365), `exp` |

---

## 4. 認証フロー図（シーケンス）

```
Browser          Frontend          Backend           Entra ID
  │                │                  │                 │
  │ [一般ログイン]  │                  │                 │
  │─POST login────>│                  │                 │
  │                │──POST /auth/login>│                 │
  │                │                  │ bcrypt verify   │
  │                │                  │─────────────────X
  │                │<─── JWT ─────────│                 │
  │<── JWT ────────│                  │                 │
  │                │                  │                 │
  │ [M365ログイン]  │                  │                 │
  │─POST m365 ────>│                  │                 │
  │                │──POST /auth/m365─>│                 │
  │                │                  │──ROPC POST ────>│
  │                │                  │<── access_token─│
  │                │                  │──GET /me ──────>│
  │                │                  │<── user info ───│
  │                │                  │ WMCDSS JWT生成  │
  │                │<─── JWT ─────────│                 │
  │<── JWT ────────│                  │                 │
  │                │                  │                 │
  │ [API リクエスト]│                  │                 │
  │ ─GET /sites───>│                  │                 │
  │                │─Authorization:───>│                 │
  │                │  Bearer JWT       │ verify JWT      │
  │                │                  │─────────────────X
  │                │<── 200 sites ────│                 │
  │<── sites ──────│                  │                 │
```

---

## 5. セキュリティ考慮事項

| 項目 | 対策 |
|------|------|
| パスワード保存 | bcrypt ハッシュ（平文保存禁止） |
| JWT 秘密鍵 | 環境変数（ソースコード外管理） |
| M365 認証情報 | 環境変数（`.env.windows`） |
| HTTPS | 社内 LAN のため HTTP 許容。外部公開時は nginx SSL 終端を追加 |
| セッション失効 | JWT 有効期限 8時間（ブラウザ閉じると再ログイン必要） |
| CORS | `WMCDSS_CORS_ORIGINS` に承認済みオリジンのみ列挙 |
| API キー | 既存の `X-API-Key` 認証と共存（管理者 API 用） |

---

## 6. 環境変数一覧

`.env.windows` に設定する認証関連の変数:

```env
# --- JWT ---
WMCDSS_JWT_SECRET=<32文字以上のランダム文字列>
WMCDSS_JWT_EXPIRE_MINUTES=480

# --- ローカルユーザー ---
# username:bcrypt_hash 形式、カンマ区切り
WMCDSS_LOCAL_USERS=admin:$2b$12$xxxxxx

# --- Microsoft 365 (Entra ID) ---
WMCDSS_ENTRA_TENANT_ID=a7232f7a-a9e5-4f71-9372-dc8b1c6645ea
WMCDSS_ENTRA_CLIENT_ID=22e5d6e4-805f-4516-af09-ff09c7c224c4
WMCDSS_ENTRA_CLIENT_SECRET=<cert/ADEntraIDCert.txt のシークレット>
WMCDSS_ENTRA_AUTHORITY=https://login.microsoftonline.com/a7232f7a-a9e5-4f71-9372-dc8b1c6645ea
WMCDSS_ENTRA_SCOPE=https://graph.microsoft.com/User.Read
WMCDSS_ENTRA_EMAIL_DOMAIN=mirai-const.co.jp
```

---

*最終更新: 2026-06-05*
