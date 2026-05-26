# 🔐 セキュリティ設計

## 1. 脅威モデル（要約）

| 想定脅威 | 緩和策 |
|---|---|
| 観測値・閾値の改竄 | mutation エンドポイントは `X-API-Key` 必須 |
| 認証失敗の網羅試行 | `hmac.compare_digest` で timing oracle を遮断 |
| ブラウザからの認証エラー読み取り不能 | CORS が auth より先に実行されるよう middleware 登録順を制御 |
| 操作者の不明化 | mutation 成功時に `audit_log(actor, action, detail)` を必ず記録 |
| ローカル開発時の摩擦 | `api_keys = []` で認証無効化を可能（本番では必ず設定） |

## 2. API Key 認証の実装ポイント

`backend/app/core/security.py`

### 2.1 設定ソース

```bash
# .env / 環境変数
WMCDSS_API_KEYS=ops-prod-aaaa,ops-prod-bbbb
WMCDSS_AUTH_REQUIRED_METHODS=POST,PATCH,PUT,DELETE
WMCDSS_AUTH_EXEMPT_PATHS=/healthz,/readyz,/docs,/openapi.json,/
```

- `api_keys` が **空のときは認証無効**（ローカル開発デフォルト）
- 本番デプロイは少なくとも 1 キーを必ず設定する（ローテーション可能なように複数持つことを推奨）

### 2.2 比較

```python
def _key_matches(presented: str, allowed: list[str]) -> bool:
    for k in allowed:
        if hmac.compare_digest(presented, k):
            return True
    return False
```

- `==` ではなく `hmac.compare_digest` を使うことで「先頭一致の長さ」から
  鍵の prefix を推測する **タイミング攻撃** を防ぐ。
- 複数キーを許す設計は、ローテーション中に新旧 2 本を並行運用するため。

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
app.add_middleware(APIKeyMiddleware)        # 後 add ＝ 先実行 ではない
app.add_middleware(CORSMiddleware, ...)     # 後 add ＝ 外側 ＝ 先実行
```

Starlette は `add_middleware` を**スタック**として扱うため、**後から add した
ミドルウェアが外側＝先に実行**される。CORS が外側なので、認証拒否の 401 に対しても
CORS ヘッダが付与され、ブラウザは body を読める。

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

## 5. 将来課題

- [ ] **キーのハッシュ保存**: 現状は env 文字列を直接突き合わせ。漏洩時の被害を狭めるため、
      DB に bcrypt/scrypt ハッシュで保存し、actor 単位で発行・失効する形に移行検討。
- [ ] **レート制限**: 認証失敗の連続回数で短期 ban。
- [ ] **mTLS / OAuth2**: 外部クライアント（他社システム連携）が増えたら検討。
