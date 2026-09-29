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
| 資格情報なしリクエストの admin 昇格 | `_credential_less_holder()` が fail-closed（401/403）。開発スタックの opt-in `WMCDSS_DEV_OPEN_ACCESS` がある場合のみ admin 相当（2026-09-29 修正。§2.6） |

## 2. API Key 認証の実装ポイント

> **2026-08-12 追記**: 読み取り系（GET）も `get_current_user_or_anon` /
> `require_*` 依存で保護する。本番（api_keys 設定済み）では Bearer JWT または
> X-API-Key が無い GET は 401。開発モード（api_keys 空）のみ無認証を許容する。
>
> **2026-09-29 修正**: 上の「開発モード（api_keys 空）のみ無認証を許容する」は
> **変更系メソッドについては誤りだった**。§2.6 を必ず読むこと。

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

HSTS は**意図的に含めない**。本番 compose（`docker-compose.production.yml`）の配信は
LAN 内の平文 HTTP であり、TLS 終端が無い状態で HSTS を名乗るのは実態と異なる。
TLS 導入と同じ変更で追加する。

> **2026-09-29 追記（MVP はこの前提から外れている）**: 公開 MVP
> （`wmcdss-mvp.mirai-dx-platform.com`）は Cloudflare Tunnel 経由で **HTTPS 配信**
> されており（実測: `http://` → 301、`server: cloudflare`、CSP / nosniff /
> X-Frame-Options 付与）、上記「平文 HTTP」の前提は MVP には当てはまらない。
> ただし HSTS の追加は **公開ホスト名のブラウザ側ポリシーを最大 age 分だけ固定する
> 変更**であり、Tunnel を外して平文へ戻す運用に切り替えた場合にアクセス不能を
> 招く。ネットワークセキュリティの変更として扱い、**実施前に
> Action / Risk / Impact / Rollback を提示して承認を得ること**（本リポジトリでは
> 未実施）。Cloudflare 側の HSTS 設定でも同等の効果が得られるため、適用面の
> 選択肢も含めて判断する。

### 2.6 資格情報なしリクエストの解決（2026-09-29 修正・重要）

**修正前の欠陥**: route 層の `require_admin_or_api_key` /
`require_hq_or_admin_or_api_key` / `require_any_user_or_api_key` /
`require_machine_client` は、`Authorization` ヘッダーが無いとき
「APIKeyMiddleware が X-API-Key を照合済みだから」という前提で
`_api_key_holder()`（= **admin 相当**）を返していた。ところが
`APIKeyMiddleware` は `api_keys` が空だと最初の分岐で丸ごと素通りする
（§2.1 の「空のときは認証無効」）。結果、**`api_keys` が空の環境では
`Authorization` ヘッダーを外すだけで匿名リクエストが admin 相当になった。**

公開 MVP は `WMCDSS_API_KEYS_RAW` が空で稼働していたため、実際に以下が
無認証で通っていた（2026-09-29 実測。body を空にした非破壊 probe で
「422/404 が返る = 認可を通過した」と判定）:

| メソッド | パス | 修正前 | 修正後 |
|---|---|---|---|
| POST | `/api/v1/sites` | 422（認可通過） | **401** |
| POST | `/api/v1/thresholds` | 422（認可通過） | **401** |
| PATCH | `/api/v1/thresholds/{id}` | 404（認可通過） | **401** |
| DELETE | `/api/v1/thresholds/{id}` | 404（認可通過） | **401** |
| POST | `/api/v1/decisions` | 422（認可通過） | **401** |
| POST | `/api/v1/observations/weather` | 422（認可通過） | **403** |
| POST | `/api/v1/observations/marine` | 422（認可通過） | **403** |

観測値は施工判断（go/caution/stop）の入力そのものであるため、これは
「第三者が任意の現場の判定を外部から操作できる」ことを意味していた。

**修正後**: 資格情報なしの解決を `_credential_less_holder(request)` に一本化した。

```python
# 優先順位（fail-closed）
1. X-API-Key が設定済みの鍵と一致      -> _api_key_holder()   # admin 相当（機械連携）
2. WMCDSS_DEV_OPEN_ACCESS=true        -> _dev_open_holder()  # 開発スタック専用の opt-in
3. それ以外                            -> 401
```

- 判定は 4 つの依存すべてで同一。1 つでも緩い経路が残ると別経路になるため。
- `_credential_less_holder` は **依存側でも X-API-Key を再照合する**。
  `auth_exempt_paths` のパスでは middleware が働かないため、
  「middleware が通したから安全」という前提に依存しない。
- `require_machine_client` は資格情報なしを **403**（API キー専用の意味を保つ）。
- `get_current_user_or_anon`（GET 用）は匿名を引き続き通すが、
  **`role="admin"` を返さない**。匿名の身元は `anon` + `default_role`（既定 `field`）とし、
  将来 role を認可判定に使った瞬間に昇格経路が復活するのを防ぐ。
- **Bearer 付きの経路は不変**。`field` ロールの JWT は
  `require_any_user_or_api_key`（判定の記録）で従来どおり許可される。

**`WMCDSS_DEV_OPEN_ACCESS` の扱い**

| 環境 | 設定 | 理由 |
|---|---|---|
| `docker-compose.yml`（開発） | 既定は **false**（`${WMCDSS_DEV_OPEN_ACCESS:-false}`） | 資格情報なしで curl したい開発者だけが `.env` で `true` を明示する（2026-09-29 に既定を反転。反転前は既定 true で、compose で起動した瞬間に匿名＝admin へ戻る fail-open だった） |
| `docker-compose.production.yml` | **渡さない**（=false） | 本番で匿名が admin になる理由はない。`${VAR:-false}` 形式で書かないのは、運用者のシェルに残った `true` が流れ込む経路を作らないため |
| `.env.production.example` | コメントで「設定しない」と明記 | 同上 |
| MVP スタック | **渡さない**（=false） | `api_keys` が空のため、渡すと穴が戻る。`deploy/MVP-STACK.md` 参照 |

> **`WMCDSS_ALLOW_INSECURE_DEFAULTS` と混同しないこと。** あちらは「起動時検査を警告へ
> 降格する」だけで、**資格情報なしリクエストを admin にする効果はない**。この混同が
> 今回の穴の背景にある。資格情報なしの扱いを決めるのは `WMCDSS_DEV_OPEN_ACCESS` ただ 1 つ。

### 2.7 独立検証で残った論点（2026-09-29 / 未決定を含む）

`docs/VERIFY-SECURITY-2026-09-29.md` の敵対的再検証で、以下が残論点として上がった。
**実装は変更していない**（Authorization の意味論に関わるため、判断を要する）。

| # | 内容 | 状態 |
|---|---|---|
| F-01 [High] | dev compose が `WMCDSS_DEV_OPEN_ACCESS` を既定 true で渡し、`api_keys` 空と組み合わさると匿名＝admin に戻る | **2026-09-29 修正済み**（既定 false へ反転。`backend/tests/test_startup_role_guards.py` が機械的に固定） |
| F-02 [High] | `POST /api/v1/auth/demo-login` が配る `field` JWT で `POST /api/v1/decisions` が通る。`/sites` は無認証で読めるため、公開デモでは「demo-login → site UUID 取得 → 判定の記録」が可能。`decisions`・`audit_log` が増え、`WMCDSS_NOTIFY_*` 設定時は偽の警戒/中止ダイジェストが送られうる（現 MVP は未設定で no-op） | **未決定**。README は「判定はすべて記録に残る」と説明しており *意図した機能* とも読める一方、公開デモとしては無制限の書き込み。選択肢: (a) 現状維持（IP 単位 60 req/min のレート制限と監査のみ）、(b) demo-login に読み取り専用ロールを新設し `POST /decisions` を拒否、(c) デモでは判定記録を無効化。**承認のうえ決定する** |
| F-03 [Medium] | `WMCDSS_DEFAULT_ROLE=admin` で匿名読み取りの身元と未登録ユーザーが admin になる | **2026-09-29 修正済み**（起動 warning を追加。fatal にはしていない） |
| F-04 [Medium] | `WMCDSS_AUTH_BYPASS_ROLE=admin\|hq` で無認証にその権限の JWT が配られる（警告なし） | **2026-09-29 修正済み**（降格後の実効ロールで判定し warning。admin/hq はより強い文言） |
| F-05 [Low] | 資格情報なしの規則が `_credential_less_holder` と `require_machine_client` に二重実装 | 未着手（片側だけ変更すると別経路が復活する） |
| F-06 [Low] | 拒否コードの不統一（`machine` のみ 403、他は 401） | 未着手（挙動としての危険はなし） |
| F-07 [Low] | `Authorization` があると `X-API-Key` が無視される | 未着手（バイパスにはならないが機械連携の癖） |
| F-08 [Info] | 匿名 GET で `/metrics`・`/etl/status`・`/` が 200 | 意図的（監視・疎通）。`/metrics` を閉じるなら監視側の認証設計と同時に |
| F-10 [Info] | 稼働コンテナが compose ラベルを持つのに compose 解決値と env が不一致（再作成手順が `docker run` と compose の 2 系統に分裂） | 未着手。`deploy/MVP-STACK.md` に `docker run` 手順を明記済み |

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
