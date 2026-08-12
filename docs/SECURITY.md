# 🔐 セキュリティ設計

## 1. 脅威モデル（要約）

| 想定脅威 | 緩和策 |
|---|---|
| 観測値・閾値の改竄 | mutation エンドポイントは `X-API-Key` 必須 |
| 業務データ（現場・判定基準・観測値）の無認証参照 | 全業務APIで JWT 必須（2026-08-12 実装。APIキーは機械連携の書き込み用） |
| 権限逸脱（協力会社による管理操作） | RBAC: `role` クレーム（field/hq/admin）+ route 依存による 403 |
| 操作者の不明化 | `actor_from()` は JWT sub を最優先。X-Actor は API キー連携時のみ |
| 認証失敗の網羅試行 | `hmac.compare_digest` で timing oracle を遮断 |
| ブラウザからの認証エラー読み取り不能 | CORS が auth より先に実行されるよう middleware 登録順を制御 |
| 操作者の不明化 | mutation 成功時に `audit_log(actor, action, detail)` を必ず記録 |
| ローカル開発時の摩擦 | `api_keys = []` で認証無効化を可能（本番では必ず設定） |

## 2. API Key 認証の実装ポイント

> **2026-08-12 追記**: 読み取り系（GET）も `get_current_user_or_anon` /
> `require_*` 依存で保護する。本番（api_keys 設定済み）では Bearer JWT または
> X-API-Key が無い GET は 401。開発モード（api_keys 空）のみ無認証を許容する。

`backend/app/core/security.py`

### 2.1 設定ソース

```bash
# .env / 環境変数
WMCDSS_API_KEYS=ops-prod-aaaa,ops-prod-bbbb
WMCDSS_AUTH_REQUIRED_METHODS=POST,PATCH,PUT,DELETE
WMCDSS_AUTH_EXEMPT_PATHS=/healthz,/readyz,/docs,/openapi.json,/metrics,/api/v1/auth/login,/api/v1/auth/login/m365,/api/v1/ai/analyze,/api/v1/ai/etl-diagnose,/api/v1/ai/risk-summary,/api/v1/ai/report-comment,/api/v1/ai/anomaly-detect,/api/v1/ai/chat,/api/v1/reports,/api/v1/etl/run
```

- `api_keys` が **空のときは認証無効**（ローカル開発デフォルト）
- 本番デプロイは少なくとも 1 キーを必ず設定する（ローテーション可能なように複数持つことを推奨）
- ⚠️ `WMCDSS_AUTH_EXEMPT_PATHS` に `"/"` を **入れてはいけない** — §2.3 参照

### 2.2 比較（hardened）

```python
_MAX_KEY_LEN = 512  # CPU-amplification guard for compare_digest

def _key_matches(presented: str, allowed: list[str]) -> bool:
    # 1) 長さ上限: 攻撃者が極端に長い鍵を送って compare_digest の比較コストを
    #    増幅させる DoS を遮断。
    if len(presented) > _MAX_KEY_LEN:
        return False
    try:
        # 2) bytes に明示変換: compare_digest は str 同士で非 ASCII が含まれると
        #    TypeError を投げる。UTF-8 にエンコードして bytes 比較に統一。
        presented_b = presented.encode("utf-8")
    except (AttributeError, UnicodeError):
        return False
    for k in allowed:
        try:
            if hmac.compare_digest(presented_b, k.encode("utf-8")):
                return True
        except (AttributeError, UnicodeError):
            continue
    return False
```

- `==` ではなく `hmac.compare_digest` を使うことで「先頭一致の長さ」から
  鍵の prefix を推測する **タイミング攻撃** を防ぐ。
- 複数キーを許す設計は、ローテーション中に新旧 2 本を並行運用するため。
- **`_MAX_KEY_LEN`**: 攻撃者は鍵を知らなくても巨大な `X-API-Key` を送って
  比較処理を増幅できる。512 byte 上限で打ち切り、`compare_digest` に渡る
  バイト列を有界化する（`test_key_matches_oversize_rejected` で回帰防止）。
- **bytes 変換**: `hmac.compare_digest` は str 同士でも非 ASCII（例: `"鍵"`）が
  含まれると `TypeError` を上げて 500 に化ける。UTF-8 にエンコードしてから渡し、
  encode 失敗時は False で安全側に倒す（`test_key_matches_non_ascii_rejected_cleanly`）。

### 2.3 exempt 判定の罠

`auth_exempt_paths` に `"/"`（ルート）を入れる必要があるが、`startswith("/")`
は全パスにマッチしてしまう。下記のように **ルートだけ完全一致のみ** とした：

```python
def _exempt(p: str) -> bool:
    if path == p:
        return True
    if p == "/":
        return False  # ★ ルートは exact-match だけ
    prefix = p if p.endswith("/") else p + "/"
    return path.startswith(prefix)
```

これにより `"/docs"` は `/docs/` と `/docs/oauth2-redirect` を許可するが、
`/api/v1/observations/weather` は **絶対に exempt されない**。

### 2.4 middleware 登録順

```python
app.add_middleware(APIKeyMiddleware)           # 内側 → 遅く実行
app.add_middleware(RateLimitMiddleware)         # ↑
app.add_middleware(CORSMiddleware, ...)         # ↑
app.add_middleware(MetricsMiddleware)           # ↑
app.add_middleware(SecurityHeadersMiddleware)   # 外側 → 先に実行
```

Starlette は `add_middleware` を**スタック**として扱うため、**後から add した
ミドルウェアが外側＝先に実行**される。実効フローは:

```
SecurityHeaders → Metrics → CORS → RateLimit → APIKey → route
```

- **SecurityHeaders 最外層**: 最終レスポンスにセキュリティヘッダーを付与。401/429/500 にもヘッダーが載る
- **Metrics**: 認証拒否やレート制限による拒否も含め全リクエストを計測
- **CORS**: 認証拒否の 401 に対しても CORS ヘッダが付与され、ブラウザは body を読める
- **RateLimit**: APIKey の上流に配置し、`hmac.compare_digest` 実行前にフラッドを遮断
- **APIKey**: 最内層で認証

### 2.5 SecurityHeadersMiddleware

`backend/app/core/security.py` の `SecurityHeadersMiddleware` が全レスポンスに
セキュリティヘッダーを付与する。nginx 側（`frontend/vite-app/nginx.conf`）でも
同種のヘッダーを付けているが、backend コンテナは `0.0.0.0` で listen しており
nginx を経由せず直接叩けるため、多層防御としてアプリ側でも付与する。

```python
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
}
```

- **X-Content-Type-Options**: Content-Type を推測させない（JSON を HTML として解釈されるのを防止）
- **X-Frame-Options: DENY**: API レスポンスが frame に埋め込まれるのを防止
- **Referrer-Policy: no-referrer**: API URL に含まれる site_id などの識別子を外部へ送出しない
- **Content-Security-Policy**: JSON API はサブリソースを読み込まない。`frame-ancestors 'none'` で frame 埋め込みを防止

Swagger UI / ReDoc が使う CDN リソースのために、`/docs` `/redoc` のパスでは
CSP の `default-src 'none'` を免除している。

HSTS は**意図的に含めない**。現状の配信は平文 HTTP であり、TLS 終端が無い状態で
HSTS を名乗るのは実態と異なる。TLS 導入と同じ変更で追加する。

## 3. 監査ログ (audit_log)

- スキーマ：`actor TEXT, action TEXT, target_type TEXT, target_id TEXT, detail JSONB, created_at TIMESTAMPTZ`
- 書き込みは **サービス層から明示的に**（`write_audit`）
  - mutation handler の `await db.commit()` の直前に呼ぶ
  - 例外は warn ログに留め、HTTP レスポンスは正常通り返す
- middleware で全リクエストを記録**しない**理由は SN 比。失敗・認可拒否まで
  業務監査に混入させたくない。

## 4. ローカル / 本番 の認証モード

| 環境 | `WMCDSS_API_KEYS` | 効果 |
|---|---|---|
| ローカル開発 | 空 | 認証無効 — 摩擦ゼロ |
| ステージング | `stg-xxx` | 認証有効 — 本番と同じ挙動 |
| 本番 | `prod-xxx,prod-yyy` | 認証有効 — 複数キーでローテーション可能 |

## 5. 鍵ローテーション運用フロー

### 5.1 設計前提

- `WMCDSS_API_KEYS` は **カンマ区切り複数キー**を受け付ける（`_key_matches` がリスト走査）。
- ローテ中は **新旧 2 本を並行受理** → クライアント切替完了後に旧を削除する 2 段階で実行。
- env 変更を反映するには **プロセス再起動が必須**（`@lru_cache get_settings`）。
- 再起動は graceful drain しないので、ローテ実施中は短時間の `5xx` / `401` 窓を許容する
  運用窓（例: 業務外時間）を選ぶ。`restart: unless-stopped` が即時復旧を保証。
- **鍵の上限**: `app/core/security.py` の `_MAX_KEY_LEN = 512` バイト。
  これを超える `X-API-Key` は受信側で reject されるため、生成・配布する鍵もこの長さ以内に収める。

### 5.2 通常ローテーション（計画的・無停止）

期待頻度: **90 日ごと**（規定）。

```bash
# ─── ① 新キー生成（オペレータホスト）─────────────────────────
NEW_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(48))")
echo "$NEW_KEY"  # ※ secret store にも保管

# ─── ② .env.production に追記（旧キー残置）──────────────────
# 編集前:
#   WMCDSS_API_KEYS=ops-prod-aaaa,ops-prod-bbbb
# 編集後:
#   WMCDSS_API_KEYS=ops-prod-aaaa,ops-prod-bbbb,<NEW_KEY>
# ※ pydantic-settings はパース失敗時に backend が起動しない。
#    保存前に `python -c "import os; print(os.environ['WMCDSS_API_KEYS'].split(','))"`
#    などで分割結果を確認。

# ─── ③ backend だけ再起動（DB は触らない）────────────────────
ssh prod-host
cd /opt/wmcdss
docker compose restart backend
docker compose logs --tail=20 backend | grep -i "starting\|listening"

# ─── ④ ヘルスチェック ───────────────────────────────────────
curl -sf http://localhost:8003/readyz
# → {"status":"ok"}

# ─── ⑤ 新キー疎通確認（mutation で 200）──────────────────────
curl -sS -X POST http://localhost:8003/api/v1/sites \
  -H "X-API-Key: $NEW_KEY" \
  -H "X-Actor: rotation-check" \
  -H "Content-Type: application/json" \
  -d '{"code":"_rotation_probe","name":"_rotation_probe","kind":"land","lat":0,"lon":0}'
# 想定: 201 か 409 (重複)。401 が返ったら ② の env 反映を再確認。

# ─── ⑥ クライアント側を新キーに切替 ─────────────────────────
# - フロント (`.env.production` の WMCDSS_API_KEY)
# - JMA ingester systemd unit (`deploy/systemd/wmcdss-jma-fetch.service` の Environment=)
# - 監視・cron スクリプト等
# 切替後、各クライアントで mutation 系を 1 回叩いて 200 を確認。

# ─── ⑦ 旧キー利用が止まったか audit_log で確認 ──────────────
# ※ audit_log には actor (X-Actor) しか残らない設計なので、X-Actor を
#    キー世代と紐付けて発行している場合は actor で世代を判定する。
#    そうでなければ、切替確認は ⑥ のクライアント側証跡をもって完了とする。

# ─── ⑧ 旧キーを .env.production から削除 ────────────────────
# 編集後:
#   WMCDSS_API_KEYS=ops-prod-bbbb,<NEW_KEY>
docker compose restart backend
docker compose logs --tail=20 backend

# ─── ⑨ 旧キー停止確認（旧キーで 401 になること）──────────────
curl -i -X POST http://localhost:8003/api/v1/sites \
  -H "X-API-Key: ops-prod-aaaa" \
  -H "X-Actor: rotation-old-key-check"
# 想定: HTTP/1.1 401 missing or invalid X-API-Key
```

### 5.3 緊急ローテーション（鍵漏洩・侵害疑い）

- ② の「旧キー残置」フェーズを **省略** し、新キー単独で env を上書き → ③ 再起動。
- 旧キー利用者は一時的に 401 になる前提で告知する。
- 漏洩経路（git 履歴・ログ・チャット添付）の事後調査は別タスクで継続。
- `audit_log` を漏洩疑い時刻範囲で grep し、actor＝漏洩鍵世代の異常 mutation がないか確認。

### 5.4 失敗時のロールバック

| 症状 | 想定原因 | 復旧 |
|---|---|---|
| backend がクラッシュループ | `WMCDSS_API_KEYS` の引用符・改行混入 / 非 ASCII / 長さ超過 | 旧 `.env.production` を `git show` から復元し再起動。secret store の値とも diff |
| 全クライアントが 401 | env 反映前の再起動忘れ / cache | `docker compose restart backend` を再実行 |
| 一部クライアントが 401 | クライアント側の鍵差し替えミス | クライアント env を再確認 — backend 側は触らない |
| `audit_log` が書かれない | X-Actor 未送出 / DB 接続切れ | backend ログで `audit:` warn を確認 — DB 再接続 |

### 5.5 監査ログ照会例

```bash
# ローテーション時刻前後の mutation 一覧（DB 直接照会）
docker compose exec db psql -U wmcdss -d wmcdss -c "
  SELECT created_at, actor, action, target_type, target_id
  FROM audit_log
  WHERE created_at >= NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC
  LIMIT 100;
"
```

## 6. 将来課題

- [ ] **キーのハッシュ保存**: 現状は env 文字列を直接突き合わせ。漏洩時の被害を狭めるため、
      DB に bcrypt/scrypt ハッシュで保存し、actor 単位で発行・失効する形に移行検討。
- [ ] **認証失敗の連続回数で短期 ban**: 現状の sliding-window rate limit は成功・失敗を
      区別しない。401 連発を別 bucket で短期 ban する設計に拡張検討。
- [ ] **mTLS / OAuth2**: 外部クライアント（他社システム連携）が増えたら検討。
- [ ] **キー世代の audit 紐付け**: `X-Actor` 命名規約に世代 ID を含めるか、
      別ヘッダ `X-Key-Generation` を導入して `audit_log.detail` に保存する案を検討。
