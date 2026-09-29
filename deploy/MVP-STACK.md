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

## ⛔ `WMCDSS_DEV_OPEN_ACCESS` を絶対に渡さないこと（2026-09-29 追加）

`WMCDSS_DEV_OPEN_ACCESS=true` は「**資格情報なしのリクエストを admin 相当として
扱う**」開発スタック専用のフラグである。既定は `false`（fail-closed）。

MVP スタックは `WMCDSS_API_KEYS_RAW` が空（`APIKeyMiddleware` が丸ごと素通り）で
あるため、このフラグを `true` にすると **Authorization ヘッダーを外すだけで
誰でも admin 相当**になり、現場・しきい値の作成/更新/削除、観測値の偽装投入、
判定の記録が公開 URL から無認証で通る（2026-08-21〜09-29 の間、実際にこの状態
だった。実測: 匿名 `POST /api/v1/sites` → 422 = 認可通過）。

- `backend.env` に **足さない**（未設定 = `false` が正しい）。
- `docker-compose.yml`（開発スタック）だけが `true` を渡す。
- `docker-compose.production.yml` / `.env.production.example` は意図的に未設定。

### 公開デモで「読み取りは誰でも・書き込みは不可」を守る構成

| 層 | 状態 | 根拠 |
|---|---|---|
| 読み取り (GET) | 無認証で可（デモの意図） | `get_current_user_or_anon` が匿名を `anon`(field) として通す |
| 変更系 (POST/PATCH/PUT/DELETE) | 401/403 | `_credential_less_holder` が 401。JWT があればロール検査 |
| 観測値投入 | 403 | `require_machine_client`（API キー or 開発フラグのみ） |
| 業務判断の記録 | field トークンで可 | `require_any_user_or_api_key`（デモの判定記録を許容） |

## ⚠️ bind mount は `docker inspect .Mounts.Source` を信用しないこと（2026-09-29 追加）

コンテナ作成後にホスト側ディレクトリを**リネーム/移動**すると、Docker が報告する
`.Mounts.Source` は**古いパス文字列のまま**残る一方、実際のマウントは移動後の
inode を指し続ける（`docker inspect` の表示と実体が乖離する）。

2026-09-29 の実測では、`wmcdss-backend` の `/app` は
`/home/kensan/Projects/_archived_Mirai-DX-Project_20260913-181810/wmcdss/backend`
（2026-09-13 にアーカイブされた旧チェックアウト）を指しており、
**リポジトリの作業ツリーで編集したコードが公開 MVP に反映されていなかった**。
`docker restart` では直らない（マウントは作り直されない）。**コンテナの再作成が必要。**

正しいマウント根を確認するコマンド:

```sh
docker exec wmcdss-backend sh -c 'grep " /app " /proc/self/mountinfo'
```

`docker inspect wmcdss-backend --format '{{range .Mounts}}{{.Source}}{{end}}'` は
リネーム前のパスを返しうるため、**単独では根拠にしない**。

### 再作成の実際（2026-09-29 に実施した手順・ロールバック付き）

```sh
# 0. 事前退避（secret を含む。リポジトリへ置かない）
umask 077
docker inspect wmcdss-backend --format '{{range .Config.Env}}{{println .}}{{end}}' > /tmp/wmcdss-mvp-backend.env

# 1. 旧コンテナは削除せず stop（ロールバック用に保持）
docker stop wmcdss-backend

# 2. 正しい作業ツリーで新コンテナを起動（--user は付けない: イメージ既定の
#    appuser(uid 999) が旧コンテナと同じ実行ユーザー）
docker run -d --name wmcdss-backend-fix --restart always \
  --network wmcdss-verify_default --network-alias backend \
  -p 127.0.0.1:18003:8000 --env-file /tmp/wmcdss-mvp-backend.env \
  -v "$PWD/backend:/app" -w /app wmcdss-backend:dev

# 3. 検証（readyz / mountinfo / 匿名 mutation が 401・403）
curl -sf http://127.0.0.1:18003/readyz
docker exec wmcdss-backend-fix sh -c 'grep " /app " /proc/self/mountinfo'

# 4. 問題なければ入れ替え
docker rm wmcdss-backend && docker rename wmcdss-backend-fix wmcdss-backend

# ロールバック（3 で問題が出た場合）
# docker rm -f wmcdss-backend-fix && docker start wmcdss-backend
```

> 実行ユーザー: `wmcdss-backend:dev` イメージの既定は `appuser`(uid 999)。
> `--user` を明示しないこと（root 実行への後退になる）。

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

## ⚠️ `git checkout` のあと公開 URL が落ちる権限の罠（2026-09-29 実障害）

**症状**: 公開 URL が無応答。`/readyz` が返らず backend コンテナが `unhealthy`。
tunnel のログには `Incoming request ended abruptly: context canceled` が並ぶ。
frontend の静的配信（`/`）は 200 のままなので「nginx は生きているのに API だけ死ぬ」に見える。

**原因**: backend コンテナは **`appuser` (uid 999) で動いており**、`./backend` を
bind mount している。ホスト側のファイルがこの uid から読めないと、`uvicorn --reload` は
app の import に失敗し続ける:

```
PermissionError: [Errno 13] Permission denied: '/app/app/core/config.py'
```

`git checkout` / `git pull` で書き換えたファイルは **そのときの umask** で作られる。
この開発環境の既定 umask は `0077` のため、書き換えられたファイルは `600`
（所有者のみ読み書き）になり、`appuser` から読めなくなる。実際に
`git checkout main` の直後に 88 ファイルが `600` になり、公開デモが停止した。

**復旧**（可逆・数秒）:

```sh
chmod -R a+rX backend            # リポジトリ全体でもよい
docker restart wmcdss-backend    # --reload が拾い直す。確実にするなら restart
curl -sf http://127.0.0.1:18003/readyz   # {"status":"ready","db":"ok"}
```

**予防**: ブランチ切替・pull のあとは `find backend -type f ! -perm -o=r | wc -l`
が 0 であることを確認する。恒久的には、コンテナをリポジトリ所有者と同じ uid で動かす、
`core.sharedRepository` を設定する、あるいは `chmod` を deploy 手順に含める、のいずれか。

## 🔁 デモ鮮度とバックアップの timer（2026-09-29 install 済み）

MVP のデモ観測は `now()` 相対で投入されるため、**放置すると鮮度ガード（気象 30 分）を
超えて全現場が caution に固定される**（下記「デモデータの鮮度」参照）。また
バックアップが 1 件も無い状態だった。次の 2 つの user timer を install 済み:

| unit | 間隔 | 実体 |
|---|---|---|
| `wmcdss-demo-refresh.timer` | 10 分 | `scripts/wmcdss-demo-refresh.sh` |
| `wmcdss-db-backup.timer` | 毎日 03:30 | `scripts/wmcdss-db-backup.sh --container wmcdss-db --keep 30` |

```sh
mkdir -p ~/.config/wmcdss
printf 'WMCDSS_HOME=%s\n' "$PWD" > ~/.config/wmcdss/deploy.env   # 秘密情報は入れない
mkdir -p ~/.config/systemd/user
cp deploy/systemd/wmcdss-demo-refresh.{service,timer} \
   deploy/systemd/wmcdss-db-backup.{service,timer} ~/.config/systemd/user/

# このスタックは compose プロジェクトに属さない（docker run 起動）ため、
# バックアップは `--container` 経路へ drop-in で切り替える
mkdir -p ~/.config/systemd/user/wmcdss-db-backup.service.d
cat > ~/.config/systemd/user/wmcdss-db-backup.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/bin/bash ${WMCDSS_HOME}/scripts/wmcdss-db-backup.sh --container wmcdss-db --keep 30
EOF

systemctl --user daemon-reload
systemctl --user enable --now wmcdss-demo-refresh.timer wmcdss-db-backup.timer
systemctl --user list-timers 'wmcdss-*'
```

`--container NAME` は compose を経由せず `docker exec` で叩く経路で、DB ユーザー /
DB 名は**コンテナ自身の `POSTGRES_USER` / `POSTGRES_DB` から導出**される
（compose の既定 `wmcdss_app` と実際のロール `wmcdss` が違うため、指定を省くと
`role "wmcdss_app" does not exist` で落ちる。`--db-user` / `--db-name` で上書き可）。

> `scripts/wmcdss-healthcheck.sh` の既定は開発 compose の `127.0.0.1:9080` を見る。
> MVP スタック（`127.0.0.1:19080`）を確認する場合は引数 / 環境変数で URL を上書きすること。
