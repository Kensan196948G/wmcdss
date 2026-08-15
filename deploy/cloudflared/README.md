# WMCDSS MVP — Cloudflare Tunnel 構成

**MVP 公開 URL**: https://wmcdss-mvp.mirai-dx-platform.com

- ドメイン: `mirai-dx-platform.com`（Cloudflare zone: `e375e651-…`）
- サブドメイン: `wmcdss-mvp`（MVP 版）
- 方式: **Cloudflare Tunnel**（本アカウントの MVP 標準。cwwd-mvp / legalops-mvp / ceop-mvp 等と同一）
- Tunnel ID: `c5363b16-393e-447c-9ca8-0d617b405966`
- DNS: `CNAME wmcdss-mvp.mirai-dx-platform.com → c5363b16-….cfargotunnel.com`（proxied: true）

## 構成

```
ブラウザ → https://wmcdss-mvp.mirai-dx-platform.com
         → Cloudflare エッジ（TLS 終端・CSP 等ヘッダー付与）
         → cloudflared（Tunnel 常駐）
         → ホスト nginx frontend（127.0.0.1:19080, docker: wmcdss-frontend）
              ├─ /api/* → backend（127.0.0.1:18003, docker: wmcdss-backend）
              ├─ /readyz /healthz → backend
              └─ その他 → SPA (index.html)
```

WMCDSS の frontend nginx が `/api` を backend へプロキシする構成のため、
Tunnel は全経路を frontend へ流すだけでよい。

## 運用（このホストでの実測構成）

### docker 常駐方式（現在運用中・推奨）

```bash
# 前提ファイル（ホスト）
#   ~/.cloudflared/c5363b16-393e-447c-9ca8-0d617b405966.json   (tunnel credentials, chmod 600)
#   ~/.cloudflared/wmcdss-mvp-docker-config.yml                (Docker 用 config, chmod 644)

docker compose -f deploy/cloudflared/docker-compose.tunnel.yml up -d
docker ps | grep wmcdss-mvp-tunnel   # restart: unless-stopped で常駐
```

### systemd 方式（代替）

```bash
sudo cp deploy/systemd/wmcdss-mvp-tunnel.service /etc/systemd/system/
sudo systemctl enable --now wmcdss-mvp-tunnel
```

（この環境では sudo 不可のため未登録。ファイルは管理下に保存済み）

### 初回セットアップ

```bash
cloudflared tunnel create wmcdss-mvp
# ~/.cloudflared/<TUNNEL_ID>.json が生成される
# ~/.cloudflared/wmcdss-mvp-config.yml を作成（deploy/cloudflared/wmcdss-mvp-config.example.yml 参照）
cloudflared tunnel --config ~/.cloudflared/wmcdss-mvp-config.yml ingress validate
# DNS CNAME を Cloudflare API で作成（proxied: true）
```

## 検証（2026-08-15 実測）

| チェック | 結果 |
|---|---|
| `https://wmcdss-mvp.mirai-dx-platform.com/` | 200（SPA・タイトル「気象海象判断支援システム」） |
| `http://…/` → 301 → `https://…/` | 301（HTTPS 強制、nginx X-Forwarded-Proto 判定） |
| `/api/v1/sites` | 200（デモ 6 現場） |
| `/api/v1/dashboard`（JWT） | 200（go/stop/caution 混在） |
| `/api/v1/audit` 未認証 | 401 |
| 判定 API（concrete / marine_lift） | go / caution / stop を確認 |
| TLS | mirai-dx-platform.com 証明書（Google Trust Services） |
| セキュリティヘッダー | CSP / X-Frame-Options / nosniff / referrer-policy |

## 注意

- 本番（`wmcdss.mirai-dx-platform.com`）は作成しない。文書方針（docs/DEPLOYMENT-OPTIONS-2026-08-12.md）どおり、本番は後継 **CWW-D** 側で運用する。
- Tunnel credentials JSON（`c5363b16-…json`）は秘密情報。Git・ログへ出力しない。
- デモデータは架空（0002_seed_demo.sql / 0004_demo_observations.sql）。実在の観測・企業・人物とは無関係。
