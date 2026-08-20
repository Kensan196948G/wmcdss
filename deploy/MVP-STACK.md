# WMCDSS MVP スタック (wmcdss-mvp.mirai-dx-platform.com)

MVP レビュー環境の構成と、ログイン認証を無効化／復旧する手順。

## 構成

| コンテナ | イメージ | 公開 | 備考 |
|---|---|---|---|
| `wmcdss-db` | `postgres:16-alpine` | `127.0.0.1:5434` | |
| `wmcdss-backend` | `wmcdss-backend:dev` | `127.0.0.1:18003` | `backend/` を `/app` へ bind mount |
| `wmcdss-frontend` | `wmcdss-verify-frontend` | `127.0.0.1:19080` | `frontend/vite-app/Dockerfile` から build |
| `wmcdss-mvp-tunnel` | `cloudflare/cloudflared` | host network | 19080 を公開 URL へ中継 |

いずれも Docker ネットワーク `wmcdss-verify_default` に属する。
backend はネットワークエイリアス `backend` で解決される（nginx の proxy_pass 先）。

> 経緯: 元は `/tmp/wmcdss-verify/docker-compose.patched.yml` から起動されていたが、
> `/tmp` の消去でその定義が失われた。再作成手順をここに残す。

## ログイン認証の無効化（MVP 公開デモ）

`WMCDSS_AUTH_BYPASS=true` のとき、`POST /api/v1/auth/demo-login` が資格情報なしで
JWT を払い出す。フロントは未ログイン時にこれを自動で叩き、成功すればログイン画面を
出さずに起動する。無効時は 404 になり、従来どおりログイン画面が出る。

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `WMCDSS_AUTH_BYPASS` | `false` | バイパスの有効化 |
| `WMCDSS_AUTH_BYPASS_USERNAME` | `demo` | 払い出す利用者名 |
| `WMCDSS_AUTH_BYPASS_ROLE` | `field` | 付与するロール（`field`/`hq`/`admin` 以外は既定ロールへ降格） |

本番 (`docker-compose.production.yml`) はこの変数を渡さないため、常に無効。

### 復旧（ログイン認証を元に戻す）

backend コンテナから `WMCDSS_AUTH_BYPASS` を外して作り直す。

## コンテナの作り直し

```sh
# frontend（ソース変更を反映する場合）
docker build -t wmcdss-verify-frontend ./frontend/vite-app
docker rm -f wmcdss-frontend
docker run -d --name wmcdss-frontend --restart always \
  --network wmcdss-verify_default --network-alias frontend \
  -p 127.0.0.1:19080:80 wmcdss-verify-frontend

# backend（環境変数を変える場合。既存 env を引き継いでから編集する）
docker inspect wmcdss-backend --format '{{range .Config.Env}}{{println .}}{{end}}' > backend.env
#  ↑ JWT 秘密鍵・ローカルユーザーの bcrypt ハッシュを含む。Git へ入れないこと
docker rm -f wmcdss-backend
docker run -d --name wmcdss-backend --restart always \
  --network wmcdss-verify_default --network-alias backend \
  -p 127.0.0.1:18003:8000 --env-file backend.env \
  -v "$PWD/backend:/app" -w /app wmcdss-backend:dev
```
