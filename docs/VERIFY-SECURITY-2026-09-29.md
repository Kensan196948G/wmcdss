# 独立検証レポート: F1「匿名 admin 昇格」修正の敵対的再検証

- 検証日時: 2026-09-29 23:29–23:45 JST
- 検証担当: verifier（task-4 / 実装者 backend-sec とは独立）
- 検証対象: task-1（F1 修正）の成果物一式
  - `backend/app/api/auth.py`（sha256 `f4bc85ca5df8961c86bfc8143a634707948a1338b1c1af1d266055100975e9b2`）
  - `backend/app/core/config.py`（sha256 `94da64b0a90b545a20417fff5013d5f92d5d77e896dadd3a520807cc7186c9a6`）
  - `backend/app/core/startup.py`, `backend/tests/*`, `docker-compose*.yml`, `.env.production.example`
- 実機: `wmcdss-backend`（127.0.0.1:18003, healthy, `uvicorn app.main:app --reload`）
  - `/app` の実マウント: `/home/kensan/Projects/Mirai-Admin-Platform/wmcdss/backend`（`/proc/self/mountinfo` で確認。旧アーカイブを指していない）
  - コンテナ内の `auth.py` sha256 はホストと一致（修正後のコードが稼働中）
  - 実効設定: `dev_open_access=False` / `api_keys=0 件` / `auth_bypass=True(role=field)` / `default_role=field` / `allow_insecure_defaults=True`

## 判定

**「穴を塞いでいる」— ただし条件付き（fail-open な既定構成が 1 つ残る）。**

- 厳密な「無認証で認可を通過する mutation route」は **0 件**（全 20 mutation route を総当たりで確認）。
- 実稼働の公開 MVP 構成（`api_keys` 空 + `dev_open_access` 未設定 = false）では、匿名の変更系は 401/403 で拒否される。**修正前は同一構成で 422/201（認可通過）だったことを自分で再現して確認した。**
- ただし **F-01 / F-02 は「塞ぎ切れていない」** と判断する（下記）。特に F-02 は「read-only デモ」という MVP の主張と矛盾する実書き込み経路である。

---

## 最重要 findings（先頭に記載）

### F-01 [High] `docker-compose.yml` が `WMCDSS_DEV_OPEN_ACCESS` を既定 `true` で渡す — リポジトリ既定の開発スタックでは穴がそのまま戻る

`_credential_less_holder` は「明示 opt-in のときだけ資格情報なしを admin 相当にする」設計であり、アプリ既定は `false` で正しい。しかし **リポジトリ内で唯一 `dev_open_access` を有効化しているファイルが `docker-compose.yml` で、しかも既定値が `true`** である。

```
$ docker compose config | grep -n -A2 -B2 DEV_OPEN_ACCESS
24:      WMCDSS_DEV_OPEN_ACCESS: "true"

# docker-compose.yml の実体
WMCDSS_DEV_OPEN_ACCESS: "${WMCDSS_DEV_OPEN_ACCESS:-true}"
```

この構成（`api_keys_raw=""` + `dev_open_access=true`）を in-process で再現すると、**修正前とまったく同じ fail-open に戻る**:

```
=== (4) docker-compose.yml 相当: api_keys 空 + dev_open_access=true ===
  anon POST   /api/v1/sites                              -> 422  {"detail":[{"type":"missing","loc":["body","code"],...
  anon POST   /api/v1/thresholds                         -> 422  {"detail":[{"type":"missing","loc":["body","work_type"],...
  anon DELETE /api/v1/thresholds/00000000-...-000000000000 -> 500  {"detail":"internal server error"}   # 認可通過後に DB へ到達
  anon POST   /api/v1/decisions                          -> 422  {"detail":[{"type":"missing","loc":["body","site_id"],...
  anon POST   /api/v1/observations/weather               -> 201  {"inserted":0,"updated":0,"skipped":0,"total":0}
```

- 422 は「ボディ検証まで到達した」= 認可通過の証拠。201 は観測値投入が実際に成立した証拠。
- 実稼働の公開 MVP は `docker compose` ではなく `docker run --env-file /tmp/wmcdss-mvp-backend.env`（`deploy/MVP-STACK.md` 記載）で再作成されており、その env に当該変数が無いため**現時点では実効 false**（＝塞がっている）。
- ただし正本が 2 系統（compose と手順書）に分かれており、**`docker compose -f docker-compose.yml up` で再作成した瞬間に公開 URL が書き込み可能に戻る**。検知手段は起動ログの warning のみ（`startup.py` の `DEV_OPEN_ACCESS` 警告）。
- 推奨: `docker-compose.yml` の既定を `false` にし、開発者が明示的に `WMCDSS_DEV_OPEN_ACCESS=true` を渡す形へ反転する（「設定し忘れた開発は不便、設定し忘れた公開は安全」ではなく「両方 fail-closed」にする）。

### F-02 [High] demo-login が配る field JWT で `POST /api/v1/decisions` が認可通過 — 「read-only デモ」が成立していない

`require_any_user_or_api_key` は対象を `get_current_user_or_anon` に統一したが、**資格情報「あり」のロジックは据え置き**のため、`field` ロールの JWT は従来どおり許可される（実装コメントにも意図として明記）。一方で実稼働の公開 MVP は `WMCDSS_AUTH_BYPASS=true` であり、**無認証で field JWT を発行するエンドポイントが公開されている**。

認可通過を非破壊で確定させた（`window_end <= window_start` の検査は `db.add` より前にあるため、400 は「認可は通過したが DB へは一切書いていない」ことの証明）:

```
POST /api/v1/auth/demo-login -> 200  role=field username=demo-field
field JWT POST /api/v1/decisions 不正window(400期待)  -> 400  {"detail":"target_window_end must be after target_window_start"}
anon      POST /api/v1/decisions 同じbody            -> 401  {"detail":"認証トークンまたは有効な X-API-Key が必要です"}
```

つまり攻撃者は次の 2 リクエストで判定記録を作成できる:
`POST /api/v1/auth/demo-login`（無認証）→ `GET /api/v1/sites`（無認証, site UUID が取れる）→ `POST /api/v1/decisions`（field JWT で 201）。

影響:
- `decisions` テーブルと `audit_log` への無制限に近い書き込み（レート制限は 60 req/min、`WMCDSS_RATE_LIMIT_PER_MINUTE=60`）。
- `app/jobs/notify_digest.py` は `status in ("stop","caution")` の Decision を通知対象にするため、**notify を設定した環境では第三者が偽の「中止/注意」警報を運用者へ送り込める**（現コンテナは `WMCDSS_NOTIFY_*` 未設定のため no-op）。
- 参考: 検証中に稼働 DB 上で `demo-field` 名義の Decision 行（2026-09-29 23:31:57, work_type=concrete, status=go）が作成されていた。**私の検証によるものではない**（私の送信は `work_type=verify-probe` かつ 400 で不成立。`select count(*) from decisions where work_type like 'verify%'` = 0）。`demo-field` は `local_users` にも存在するため demo-login 経由と断定はできないが、経路自体が生きていることは上記 400 で独立に確認済み。
- 推奨（いずれか）: (a) `auth_bypass=true` のときは `require_any_user_or_api_key` の資格情報なし経路を 401 のままにしつつ、demo-login を `POST /decisions` の認可から除外する（例: `require_any_user_jwt` を新設し demo ロールだけ許可）／(b) デモの判定記録を「書き込まないプレビュー」に変える／(c) 少なくとも `auth_bypass` 有効時は `decisions` への write をレート制限＋監査ではなく拒否する。

---

## A. 修正内容の読解 — 実施

`git diff backend/app/api/auth.py backend/app/core/config.py backend/app/core/startup.py` を全行読解。

| 依存 | 資格情報なしの扱い | 統一 |
|---|---|---|
| `require_admin_or_api_key` | `return _credential_less_holder(request)` | ✅ |
| `require_hq_or_admin_or_api_key` | `return _credential_less_holder(request)` | ✅ |
| `require_any_user_or_api_key` | `return _credential_less_holder(request)` | ✅ |
| `require_machine_client` | 同等規則を**インラインで再実装**（→ F-05） | ⚠️ 規則は同じ |

- `_credential_less_holder` の規則: ①`X-API-Key` が設定済み鍵と一致 → `_api_key_holder()`（admin） ②`dev_open_access` が true → `_dev_open_holder()`（admin） ③それ以外 → 401。**fail-closed であり、規則として妥当。**
- 既定値: `dev_open_access: bool = False`（`config.py`）。`Settings().dev_open_access is False` を新テストが固定（`test_dev_open_access_is_false_by_default`）。✅
- env 名一致: `BaseSettings(env_prefix="WMCDSS_")` + フィールド名 `dev_open_access` → `WMCDSS_DEV_OPEN_ACCESS`。コンテナ内 `get_settings().dev_open_access` で実際に読めることを確認（未設定時 False）。✅
- 「別経路で admin になれる」経路: `_api_key_holder()` の呼び出し元は `_credential_less_holder` と無条件で admin を返す `get_current_user_or_anon` の api_keys 設定時分岐のみ。後者は `key_matches` 成功時のみ到達。✅
- 匿名読み取り: `get_current_user_or_anon` は `dev_open_access=false` のとき `UserInfo(username="anon", auth_type="anonymous", role=s.default_role)` を返す（旧: `role="admin"`）。✅（ただし F-03）
- 起動時警告 `startup.py` に `WMCDSS_DEV_OPEN_ACCESS` 有効時の警告を追加。✅

## B. 修正前の再現 — 実施（独立再現に成功）

作業ツリーは汚さず、`/tmp` にコピーを作って再現した。検証後 `/tmp/verify-b*` は削除済み。

**(B-1) `auth.py` を HEAD へ完全 revert したコピー**（`git show HEAD:backend/app/api/auth.py`）で新テストを実行:

```
$ cd /tmp/verify-b && pytest -q tests/test_admin_guard.py
17 failed, 15 passed, 7 warnings in 2.99s
FAILED ...::test_anonymous_post_sites_is_denied_when_flag_off
FAILED ...::test_anonymous_delete_threshold_is_denied_when_flag_off
FAILED ...::test_anonymous_post_decisions_is_denied_when_flag_off
FAILED ...::test_anonymous_observation_ingest_is_denied_when_flag_off[weather|marine]
FAILED ...::test_anonymous_bogus_api_key_is_denied_when_flag_off
FAILED ...::test_all_credential_less_deps_reject_when_flag_off[admin|hq|any|machine]
FAILED ...::test_valid_api_key_is_accepted_by_deps[admin|hq|any]
FAILED ...::test_anonymous_read_identity_is_not_admin_when_flag_off
FAILED ...::test_hq_jwt_is_allowed_on_hq_route        (TypeError: 旧シグネチャ)
FAILED ...::test_field_jwt_is_allowed_on_any_user_route (TypeError)
FAILED ...::test_authorization_precedes_id_validation_for_thresholds
```

**(B-2) シグネチャは据え置き、規則だけ修正前に戻したコピー**（`_credential_less_holder` の最終行を `return _api_key_holder()`、`get_current_user_or_anon` の匿名分岐を `_api_key_holder()`）:

```
9 failed, 23 passed, 7 warnings in 2.47s
```

`require_machine_client` の新規則は戻していないため observation 系は green のまま = **テストが「どの規則」を検出しているかが特定できている**。TypeError を除いた実質的な規則検出は B-1/B-2 の両方で成立。

**(B-3) 修正前コード × 実稼働と同一設定**（`api_keys=""`, `dev_open_access=False`, `auth_bypass=True`, role=field）で HTTP を再現:

```
### PRE-FIX (HEAD auth.py) + 実稼働と同一設定 ###
  anon POST   /api/v1/sites                      -> 422
  anon POST   /api/v1/thresholds                 -> 422
  anon PATCH  /api/v1/thresholds/<uuid>          -> 404
  anon DELETE /api/v1/thresholds/<uuid>          -> 404
  anon POST   /api/v1/decisions                  -> 422
  anon POST   /api/v1/observations/weather       -> 201
  anon POST   /api/v1/observations/marine        -> 201
```

⇒ 実稼働と同じ設定で「修正前は認可通過、修正後は拒否」を同一条件で対比できた。**Lead が示した修正前の値（422 / 404 / 422 / 422）と一致。**

## C. 修正後の再検証 — 実施（稼働中 127.0.0.1:18003 への非破壊 probe）

```
########## 匿名 (資格情報なし) mutation ##########
POST   /api/v1/sites                            401  {"detail":"認証トークンまたは有効な X-API-Key が必要です"}
POST   /api/v1/thresholds                       401  {"detail":"認証トークンまたは有効な X-API-Key が必要です"}
PATCH  /api/v1/thresholds/<uuid>                401  {"detail":"認証トークンまたは有効な X-API-Key が必要です"}
DELETE /api/v1/thresholds/<uuid>                401  {"detail":"認証トークンまたは有効な X-API-Key が必要です"}
POST   /api/v1/decisions                        401  {"detail":"認証トークンまたは有効な X-API-Key が必要です"}
POST   /api/v1/observations/weather             403  {"detail":"このエンドポイントは API キー専用です"}
POST   /api/v1/observations/marine              403  {"detail":"このエンドポイントは API キー専用です"}
POST   /api/v1/etl/run/9999                     401  {"detail":"認証トークンが必要です"}
POST   /api/v1/reports                          401  {"detail":"認証トークンが必要です"}
POST   /api/v1/ai/settings                      401  {"detail":"認証トークンが必要です"}
########## 匿名 GET (read-only デモ) ##########
GET    /healthz                                 200
GET    /readyz                                  200
GET    /api/v1/sites                            200
GET    /api/v1/dashboard                        200
GET    /api/v1/audit                            401  {"detail":"認証トークンが必要です"}
GET    /api/v1/etl/status                       200
GET    /openapi.json                            404
########## field トークン ##########
POST /api/v1/auth/demo-login                    200  role=field username=demo-field
field JWT GET  /api/v1/sites                    200
field JWT GET  /api/v1/dashboard                200
field JWT GET  /api/v1/audit                    403
field JWT POST /api/v1/sites                    403
field JWT POST /api/v1/thresholds               403
field JWT PATCH /api/v1/thresholds/<uuid>       403
field JWT DELETE /api/v1/thresholds/<uuid>      403
field JWT POST /api/v1/decisions                422  ← 認可通過（F-02）
field JWT POST /api/v1/observations/weather     403
field JWT POST /api/v1/etl/run/9999             403
field JWT POST /api/v1/reports                  403
field JWT POST /api/v1/ai/settings              403
field JWT GET  /api/v1/auth/me                  200  role=field
########## 不正資格情報 ##########
empty X-API-Key                                 401
non-ASCII X-API-Key (鍵, raw curl)              401  （500 にならない）
100KB X-API-Key (raw curl)                      401
8KB X-API-Key (raw curl)                        401
duplicate X-API-Key: a + b                      401
invalid X-API-Key "guessed"                     401
lowercase x-api-key                             401
bogus JWT "Bearer xxx"                          401  {"detail":"無効または期限切れのトークンです"}
lowercase scheme "bearer xxx"                   401  {"detail":"無効または期限切れのトークンです"}
tampered field JWT                              401  {"detail":"無効または期限切れのトークンです"}
Basic auth                                      401
raw token (scheme なし)                         401
空 Authorization (raw)                          401
duplicate Authorization (xxx + yyy)             401
field JWT + bogus X-API-Key                     403
bogus JWT + bogus X-API-Key                     401
```

- **有効な API キーでの到達は稼働機では未検証**（`api_keys` が 0 件で、鍵が設定されていないため）。in-process で `Settings(api_keys_raw="s3cret-key")` + `X-API-Key: s3cret-key` を与え、`require_admin_or_api_key(credentials=None, request=...)` が `role=admin` を返すこと、`require_machine_client` が `None` を返すことを確認済み（`tests/test_admin_guard.py::test_valid_api_key_is_accepted_by_deps` / `test_machine_client_accepts_valid_api_key` と同内容を独立に再実行）。
- 稼働コンテナは `WMCDSS_DEV_OPEN_ACCESS` を **持たない**（`docker inspect` の env 一覧に出現しない）ため、実効 `false`。`docker compose config` の解決値（`"true"`）と一致しない理由は F-01 / F-10 に記載。

## D. 追加の攻撃面（網羅性チェック）— 実施

`app.routes` を再帰的に走査（`_IncludedRouter` 対応）して route を列挙し、さらに OpenAPI 非公開の `demo-login` も拾った。**mutation route は 20 件**。

認可依存の静的な有無（`route.dependant` を再帰走査）:

```
OK  POST   /api/v1/ai/analyze                  auth=['get_current_user']          exempt=/api/v1/ai/analyze
OK  POST   /api/v1/ai/anomaly-detect           auth=['get_current_user']          exempt=...
OK  POST   /api/v1/ai/chat                     auth=['get_current_user']          exempt=...
OK  POST   /api/v1/ai/etl-diagnose             auth=['get_current_user']          exempt=...
OK  POST   /api/v1/ai/report-comment           auth=['get_current_user']          exempt=...
OK  POST   /api/v1/ai/risk-summary             auth=['get_current_user']          exempt=...
OK  POST   /api/v1/ai/settings                 auth=['require_admin_jwt']         exempt=None
OK  POST   /api/v1/ai/test                     auth=['require_admin_jwt']         exempt=None
*** NO-ROUTE-AUTH *** POST /api/v1/auth/demo-login   auth=[]            exempt=None   schema=False
*** NO-ROUTE-AUTH *** POST /api/v1/auth/login        auth=[]            exempt=/api/v1/auth/login
*** NO-ROUTE-AUTH *** POST /api/v1/auth/login/m365   auth=[]            exempt=/api/v1/auth/login
OK  POST   /api/v1/decisions                   auth=['require_any_user_or_api_key'] exempt=None
OK  POST   /api/v1/etl/run/{job_id}            auth=['require_admin_jwt']          exempt=/api/v1/etl/run
OK  POST   /api/v1/observations/marine         auth=['require_machine_client']     exempt=None
OK  POST   /api/v1/observations/weather        auth=['require_machine_client']     exempt=None
OK  POST   /api/v1/reports                     auth=['require_hq_or_admin_jwt']    exempt=/api/v1/reports
OK  POST   /api/v1/sites                       auth=['require_admin_or_api_key']   exempt=None
OK  POST   /api/v1/thresholds                  auth=['require_admin_or_api_key']   exempt=None
OK  DELETE /api/v1/thresholds/{threshold_id}   auth=['require_admin_or_api_key']   exempt=None
OK  PATCH  /api/v1/thresholds/{threshold_id}   auth=['require_admin_or_api_key']   exempt=None
```

動的総当たり（資格情報なし、`{}` / `[]` の**不正ボディ**、`etl/run` は存在しない 9999）:

```
POST   /api/v1/ai/analyze            401     POST   /api/v1/ai/anomaly-detect    401
POST   /api/v1/ai/chat               401     POST   /api/v1/ai/etl-diagnose     401
POST   /api/v1/ai/report-comment     401     POST   /api/v1/ai/risk-summary     401
POST   /api/v1/ai/settings           401     POST   /api/v1/ai/test             401
POST   /api/v1/auth/demo-login       200  ← 設計上無認証（JWT 払い出し。データ変更なし）
POST   /api/v1/auth/login            422  ← 設計上無認証（認証エンドポイント）
POST   /api/v1/auth/login/m365       422  ← 設計上無認証（認証エンドポイント）
POST   /api/v1/decisions             401     POST   /api/v1/etl/run/9999        401
POST   /api/v1/observations/marine   403     POST   /api/v1/observations/weather 403
POST   /api/v1/reports               401     POST   /api/v1/sites              401
POST   /api/v1/thresholds            401     DELETE /api/v1/thresholds/<uuid>   401
PATCH  /api/v1/thresholds/<uuid>     401
認可通過(401/403以外・auth 系以外): なし
```

**結論: 業務データを変更する mutation route で資格情報なしに 422/404/200 が返るものは 0 件。** `auth_exempt_paths` に載る mutation（`/ai/*` 6 件・`/reports`・`/etl/run`）はすべて route 層で JWT を要求しており、middleware 免除が穴になっていない。`auth_required_methods` を運用で書き換えても route 層が独立に守る（多層防御が機能）。

`demo-login` は `auth_exempt_paths` に**含まれていない**ため、(a) `auth_bypass=false` なら handler が 404、(b) `api_keys` 設定時は middleware が 401、と二重に閉じる。

## E. bypass 有効時の危険性の再評価 — 実施

`field` ロール（demo-login が配る唯一のロール）で実際に叩いた範囲:

| 種別 | 結果 |
|---|---|
| GET `/sites` `/dashboard` `/observations/*` `/thresholds` `/etl/status` `/auth/me` | 200 |
| GET `/audit` | 403（`require_admin_jwt`） |
| GET `/ai/settings` | 401 |
| POST `/sites` `/thresholds` PATCH/DELETE `/thresholds` | 403 |
| POST `/etl/run/*`, `/reports`, `/ai/settings` | 403 |
| POST `/observations/weather|marine` | 403 |
| **POST `/decisions`** | **422（認可通過）／不正 window で 400** |

**判断: 「read-only デモ」としては許容できない（F-02, High）。**
- 無認証で取得できる field トークンにより、公開 URL から `decisions` + `audit_log` への書き込みが可能。判定記録は監査対象データであり、`notify_digest` 経由で誤警報になり得る。
- それ以外の範囲（GET は業務データ閲覧のみ、`/audit` と `/ai/settings` は拒否、構成系 mutation は admin 必須）は「閲覧デモ + 限定的な判定記録」として妥当な設計であり、過剰な締め出しにはなっていない。
- 補足（F-04）: `WMCDSS_AUTH_BYPASS_ROLE` は `field/hq/admin` を受理し、`admin` を設定すると demo-login が**無認証で admin JWT** を配る。`auth_bypass` / `auth_bypass_role` は `startup.py` の監査対象に含まれておらず警告すら出ない（`grep -rn "auth_bypass" backend/app/` で config.py と auth.py のみ）。現コンテナは `field` なので実害なし。

## F. 回帰 — 実施

```
$ cd backend && .venv/bin/python -m pytest -q --ignore=tests/test_api_smoke.py
427 passed, 10 warnings in 16.31s

$ .venv/bin/python -m ruff check .
All checks passed!     (exit=0)

$ .venv/bin/python -m pytest -q --collect-only tests/test_admin_guard.py
32 tests collected
```

- 追加テスト `tests/test_admin_guard.py` は **32 件・全 pass**（parametrize 込み。`def test_` は 24 個）。
- `dev_open_access=True` を autouse fixture で opt-in した既存モジュールは **76 件**（`test_sites` 6 / `test_thresholds` 10 / `test_observations` 13 / `test_decisions` 25 / `test_boundary_errors` 22）。
- **既存テストの削除・skip・xfail・assertion 緩和は無い**。`git diff -U0 -- backend/tests/` の削除行は陳腐化した docstring 4 行のみ:

```
-  * The API has no role-based authorization layer, so there is no "403
-    forbidden" path for application users. Write authorization is enforced by
-    ``APIKeyMiddleware``, which returns **401** (not 403) when ``X-API-Key`` is
-    missing or wrong. We therefore assert the actual 401 boundary.
```

```
$ grep -rn "pytest.skip\|pytest.mark.xfail\|@pytest.mark.skip" backend/tests/  → なし
```

- テスト件数は他担当が並行して追加中のため変動しうる（本計測時点で `test_dashboard_summary.py` `test_demo_refresh_values.py` が新規追加されていた）。

## 残存リスク（修正の範囲外・別タスク推奨）

| # | Sev | 内容 |
|---|---|---|
| F-01 | High | `docker-compose.yml` の `WMCDSS_DEV_OPEN_ACCESS` 既定 true（上記） |
| F-02 | High | demo-login field JWT → `POST /decisions` 認可通過（上記） |
| F-03 | Medium | `WMCDSS_DEFAULT_ROLE=admin` で匿名読み取り身元が `role=admin`、かつ `role_users` 未登録ユーザーの JWT が admin。`startup.py` に `default_role` の検査が無い。新テスト `test_anonymous_read_identity_is_not_admin_when_flag_off` は `default_role` を固定していないため、この経路を検出できない。実測: `get_current_user_or_anon(credentials=None).role = 'admin'`（`default_role="admin"`, `dev_open_access=False`）。現状 `get_current_user_or_anon` の role を認可判定に使う route は無いので**潜在**（防御の深さの問題） |
| F-04 | Medium | `WMCDSS_AUTH_BYPASS_ROLE=admin` で無認証 admin JWT。`auth_bypass*` は起動時監査の対象外 |
| F-05 | Low | 資格情報なしの判断規則が `_credential_less_holder` と `require_machine_client` のインライン実装に**二重化**。片側だけ変更されると別経路が復活する。共通ヘルパー（`_has_valid_api_key(request)` / `_dev_open_or_none()`）へ寄せるべき |
| F-06 | Low | 拒否コードの不統一: 資格情報なしで `require_machine_client` のみ **403**、他は 401。`api_keys` 設定時は middleware が 401 を返すため「鍵なし」が経路により 401/403 になる。バイパスや情報漏洩にはならないが契約として不明瞭。文言「このエンドポイントは API キー専用です」は認証方式を開示する |
| F-07 | Low | `Authorization` ヘッダーが存在すると `X-API-Key` が無視される（3 依存すべて）。有効な API キー + 不正/失効 JWT を併送すると 401 になる。機械連携が古い `Authorization` を送り続けると壊れる。バイパスではない |
| F-08 | Info | 匿名 GET で `/metrics`（プロセス・GC メトリクス）, `/api/v1/etl/status`（ジョブ名・最終実行・stale 状態）, `/`（エンドポイント一覧）が 200。read-only デモの公開範囲として明示的な判断が必要 |
| F-09 | Info | task-1 完了報告の数値の一部が不一致: 「既存 50 件」→ 実測 **76 件**、新テスト先行実行の passed「13」→ 私の再現では **15**（failed 17 は一致）。実装内容の結論には影響しない |
| F-10 | Info | 稼働コンテナは compose ラベル（`com.docker.compose.project=wmcdss`）を持つが、`WMCDSS_DEV_OPEN_ACCESS` の実効値が `docker compose config` の解決値（true）と一致しない。再作成が `docker run --env-file` と compose の 2 系統に分裂しており、どちらの構成が正本か判別しにくい。`docker compose ls` に `wmcdss` プロジェクトが現れない |

## 非破壊の証明

- 匿名 POST のボディはすべて `{}` / `[]`（バリデーションで拒否される不正ボディ）。`/api/v1/etl/run/*` は存在しない **9999** のみ。ETL は起動していない（401 で拒否）。
- 稼働 DB への書き込みは行っていない。確認:

```
$ docker exec wmcdss-db psql -U wmcdss -d wmcdss -tAc \
  "select count(*) from decisions where work_type like 'verify%' or generated_by like 'verify%';"  → 0
$ docker exec wmcdss-db psql -U wmcdss -d wmcdss -tAc \
  "select count(*) from sites where code like 'verify-%';"                                          → 0
```

- `demo-field` 名義の Decision 行（23:31:57）は私の送信ではない（`work_type=concrete`。私の送信は `verify-probe` かつ 400 で不成立）。
- docker コンテナ / DB の再起動・再作成、DB の DROP/TRUNCATE/大量 DELETE は実施していない。
- 作業ツリーへの書き込みは本ファイルのみ。`backend/app/api/auth.py` `backend/app/core/config.py` の sha256 は検証前後で不変。`git commit` / `push` は実施していない。
- 一時ファイル（`/tmp/verify-b`, `/tmp/verify-b2`, `/tmp/probe*.py`, `/tmp/probe_c.sh`, `/tmp/routes.txt`, `/tmp/authcov.txt`, `/tmp/body.txt`, `/tmp/*.hdr`）は削除済み。
- 秘密値（`JWT_SECRET` / `ENTRA_CLIENT_SECRET` / `LOCAL_USERS` / `API_KEYS_RAW`）は本レポートに含めていない。コンテナ env は表示時に伏せ字化した。

## 未実施項目

- **稼働機での有効な API キー経路**: 稼働コンテナに API キーが設定されていないため未実施。in-process（`Settings(api_keys_raw=...)`）でのみ確認した。
- **`api_keys` 設定 + `dev_open_access=true` の実 HTTP 検証**: 稼働機の設定を変更できないため、in-process の TestClient で実施。結果は「匿名 mutation は middleware が 401 で拒否／免除パスは route 層 `*_jwt` が 401」で、**新たなバイパスは生じない**ことを確認:

```
### (3b) HTTP: dev_open_access=true + api_keys=prod-key, 匿名 mutation ###
  anon POST /api/v1/sites                  -> 401  {"detail":"missing or invalid X-API-Key"}
  anon POST /api/v1/decisions              -> 401  {"detail":"missing or invalid X-API-Key"}
  anon POST /api/v1/observations/weather   -> 401  {"detail":"missing or invalid X-API-Key"}
  anon POST /api/v1/etl/run/9999           -> 401  {"detail":"認証トークンが必要です"}
  anon POST /api/v1/reports                -> 401  {"detail":"認証トークンが必要です"}
```

- **公開 URL（cloudflared 経由）からの実攻撃**: 外部境界の検証は本タスクの範囲外（nginx/cloudflared の設定は未レビュー）。
- **`auth_required_methods` を非既定値にした場合の実 HTTP 検証**: route 層の独立防御は静的解析で確認したが、実 HTTP では未実施（F-01 の compose 再現時のみ間接的に確認）。
