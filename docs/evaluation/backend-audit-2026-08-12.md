# WMCDSS バックエンド・セキュリティ・データ品質監査（2026-08-12）

対象: `backend/` 全ソース、`db/migrations/`、`scripts/wmcdss-db-backup.sh`
検証時点: commit `b087921`（main）+ ローカル実行（backend pytest 344 passed / ruff clean）

## 1. 認証・認可マトリクス（実測コードベース）

| エンドポイント | メソッド | APIキー層 | JWT層 | 実態評価 |
|---|---|---|---|---|
| /healthz, /readyz, /metrics | GET | 免除 | 不要 | 妥当（死活監視） |
| /api/v1/auth/login, /login/m365 | POST | 免除 | 不要 | 妥当（ログイン自体） |
| /api/v1/auth/me | GET | 不要（POST以外） | 必要 | 妥当 |
| /api/v1/sites | GET | 不要 | **不要** | **問題: 無認証で全現場情報を取得可** |
| /api/v1/sites | POST/PATCH/DELETE | 必要 | 不要 | 問題: X-Actor偽装可・JWT不要 |
| /api/v1/thresholds | GET | 不要 | **不要** | **問題: 判定基準（安全上重要）が無認証公開** |
| /api/v1/thresholds | POST/PATCH/DELETE | 必要 | 不要 | 問題: APIキー保持者なら誰でも書き換え可・アクター偽装可 |
| /api/v1/observations/* | GET | 不要 | **不要** | 問題: 観測データが無認証公開 |
| /api/v1/observations/* | POST | 必要 | 不要 | 問題: アクター偽装可 |
| /api/v1/decisions | POST | 必要 | 不要 | 問題: 判定の`generated_by`は"system"固定・アクター匿名化 |
| /api/v1/analysis/* | GET | 不要 | **不要** | 問題: 解析データ無認証公開 |
| /api/v1/etl/status | GET | 不要 | **不要** | 問題: 取得状況無認証公開 |
| /api/v1/etl/run/{id} | POST | 免除 | 必要 | 妥当 |
| /api/v1/audit | GET | 不要 | 必要（全ログイン者） | **問題: RBAC無しで誰でも監査ログ閲覧可** |
| /api/v1/reports | POST | 免除 | 必要（全ログイン者） | 問題: RBAC無し（CSV/Excel全量出力） |
| /api/v1/ai/* | POST | 免除 | 必要（全ログイン者） | **問題: AI設定は誰でも変更可（後述B5）** |

## 2. 発見項目

### B1 [P0] 業務APIの読み取りが全て無認証
証拠: `app/api/sites.py:15`, `app/api/thresholds.py:30`, `app/api/observations.py:61`, `app/api/decisions.py:113`, `app/api/analysis.py:70` に JWT 依存が無い。`app/core/security.py` のAPIKeyMiddlewareは `auth_required_methods`（既定POST/PATCH/PUT/DELETE）のみ保護。
影響: 現場所在地・判定基準・観測データの全量参照。インターネット公開時は情報漏えい。
修正: 全業務ルートにJWT必須化（`app/core/dependencies.py` / `require_auth`）。

### B2 [P0] 監査アクターが匿名または偽装可能
証拠: `app/core/security.py actor_from()` は `X-Actor` ヘッダーを信用し、無ければ `"anonymous"`。Web UI（`frontend/vite-app/src/api.ts`）は X-Actor を送らないため、UIからの全操作が `anonymous` で記録される。
影響: 「誰が判定・変更したか」が監査から追跡不能。APIキー保持者は任意のアクター名を偽装可。
修正: JWTの `sub` を最優先アクターにし、X-Actor はAPIキー連携時のみ許容。

### B3 [P0] RBACが未実装（usersテーブルはスキーマのみ）
証拠: `db/migrations/0001_init.sql` に `users` テーブル定義があるが、SQLAlchemyモデル・API・ロジックは存在しない。JWTにroleクレーム無し。
影響: 現場担当者・本社・協力会社の権限分離が不可能。
修正: usersモデル+migration 0003+ログイン時upsert+JWT role+`require_roles`。

### B4 [P0] AI設定（Anthropic APIキー）を全ログイン者が変更可能
証拠: `app/api/ai.py` の settings 系エンドポイントは `get_current_user` のみでrole検査なし。`_save_settings_file()` が `/app/data/ai_settings.json` にAPIキーを保存。
影響: 認証済みユーザー1名で (a) APIキー差し替え→従量課金の迂回・DoS、(b) モデル変更→AI結果の改変。
修正: settings系をadmin限定。

### B5 [P1] 判定のgenerated_byが常に"system"
証拠: `app/api/decisions.py` で `generated_by="system"` 固定。監査の `decision.create` も actor が anonymous。
影響: 判定の責任主体が記録されない。
修正: `generated_by=current_user.username` 化＋監査アクターへJWT sub設定。

### B6 [P1] JMA波浪ナウキャストURLが404（実測）
証拠: `app/services/jma_wave.py WAVE_URL_TEMPLATE` = `https://www.jma.go.jp/bosai/wave/data/point/{lat:.2f}_{lon:.2f}/{yyyymmdd}.json`。2026-08-12 実測で 404。現行JMA提供は `https://www.jma.go.jp/bosai/wave/data/swjp/{station_id}.json`（観測局6点・2026-03-25で更新停止）と `const/pointinfo.json` による観測局方式。
影響: 海象取り込みが本番で機能しない。海上作業判定は欠測→caution（安全側だが機能喪失）。
修正方針: Open-Meteo（参考情報）とNOWPHAS（国交省・公的）への切替をPhase 3で実施。本評価では鮮度ガード導入＋「海象は参考情報」と明示。

### B7 [P1] 観測値の鮮度チェックが無い
証拠: `app/api/decisions.py _latest_inputs()` は `observed_at.between(t0-3h, t1)` の最新1行を無条件採用。
影響: ETL停止中に古い観測値で「go」が出る可能性。
修正: weather 60分・marine 180分の鮮度上限を導入し、超えたら欠測扱い。

### B8 [P1] レポートが全ログイン者に全量出力可能
証拠: `app/api/reports.py` は `get_current_user` のみ。サイト・期間・テンプレート指定で監査データ含むCSV/Excelを出力可能。
影響: 協力会社ユーザーによる全量持ち出し。
修正: admin/hq限定。

### B9 [P1] M365 ROPC（パスワード直接認証）のリスク
証拠: `app/core/auth.py authenticate_m365()` は grant_type=password。Entra未設定時は503で安全側。
影響: パスワードがWMCDSSサーバー経由でEntraに送られる。条件付きアクセス・MFAと非互換。HENNGE ONE連携も未実装。
修正: 文書でリスク明示＋利用条件を記載。対話型フローはPhase 3候補。

### B10 [P1] レート制限が既定無効
証拠: `app/core/config.py rate_limit_per_minute: int = 0`（0=無効）。`.env.production.example` は60を指定するが、env省略時は無制限。
影響: ログイン総当たり・API乱用。
修正: 既定値を60に引き上げ＋テスト追加。

### B11 [P2] 取り込みAPIの一括投稿に上限が無い
証拠: `app/api/observations.py ingest_weather/marine` は list を無制限受付。
影响: 巨大ペイロードでDB負荷・DoS。
修正: 上限（例: 1回10,000件）を追加予定。

### B12 [P2] バックアップはローカル保存のみ・リストアスクリプト無し
証拠: `scripts/wmcdss-db-backup.sh` は `backups/` に世代保存するが、外部退避・リストア実行・定期検証は無い。
影響: サーバー障害時にバックアップも失われる。
修正: `scripts/wmcdss-db-restore.sh`（ドライラン対応）と検証手順を追加。

### B13 [P2] users/etl_runs/forecasts テーブルが未使用
証拠: `db/migrations/0001_init.sql` に定義あり、`app/models/` にモデル無し。
影響: スキーマとコードの乖離。
修正: users は B3 で利用開始。forecasts はPhase 3、etl_runs は監視強化で利用予定。

### B14 [P2] JWTをlocalStorage保存（XSS時のトークン窃取）
証拠: `frontend/vite-app/src/auth-token.ts TOKEN_KEY = 'wmcdss_access_token'`。
影響: XSSがあればセッション乗っ取り。
修正: httpOnly Cookie方式はPhase 3候補。当面CSPでXSSリスク軽減。

### B15 [P2] データ鮮度・欠測の可視化がUIで不十分
証拠: 観測値の `fetched_at` はDBにあるが、画面表示は `observed_at` のみ。
影響: データが古いことにユーザーが気づかない。
修正: 画面に観測時刻表示を追加。

### B16 [P2] 異常値チェックがAIエンドポイントのみ
証拠: `/ai/anomaly-detect` は存在するが、取り込み時に自動で異常値を拒否・フラグしない。
影響: センサー異常値がそのまま判定に使われる可能性。
修正: 取り込み時の範囲チェックをPhase 3候補に。

### B17 [P2] 依存関係のライセンス確認が未実施
証拠: `backend/pyproject.toml` にライセンス情報なし。Open-Meteo無料APIは非商用限定（open-meteo.com/en/terms）。
影響: 商用本番でOpen-Meteo利用がライセンス違反になる恐れ。
修正: 文書で「参考情報・非商用限定・有料契約またはJMA/NOWPHASへの切替」を明記。

## 3. テストギャップ

- 認証境界: 読み取りAPIが無認証であることを固定するテストが存在しない（`test_route_auth.py` は書き込み中心）。
- RBAC: ロール別403のテストが存在しない。
- 鮮度: 古い観測値で判定するケースのテストが存在しない。
- レポート: 権限・フォーマット異常系のテストが少ない。
- リストア: バックアップ検証テストが存在しない（手動ドリル推奨）。

## 4. 今すぐ修正すべきTOP10（本評価で実装）

1. 全業務APIのJWT必須化（B1）
2. 監査アクターをJWT subに変更（B2）
3. RBAC基盤（usersモデル+migration+roleクレーム+require_roles）（B3）
4. AI設定をadmin限定に（B4）
5. 判定generated_by/アクター修正（B5）
6. 観測鮮度ガード（B7）
7. レポート・監査ログをadmin/hq限定に（B8）
8. レート制限の既定有効化（B10）
9. リストアスクリプト追加（B12）
10. 海象データの現状明示（B6文書化）

## 5. 対応状況（2026-08-12 実装後）

| 発見 | 対応 | 実装形態 |
|---|---|---|
| B1 読み取り無認証 | 修正 | 全業務APIへ `get_current_user_or_anon` / `require_*` を適用（JWT必須、APIキーは機械連携用） |
| B2 アクター匿名化 | 修正 | `actor_from()` が JWT sub を優先。判定 `generated_by` も JWT ユーザー名化 |
| B3 RBAC未実装 | 修正（envベース） | `WMCDSS_ROLE_USERS_RAW` + `WMCDSS_DEFAULT_ROLE` で role クレーム発行。管理操作は admin、レポートは hq 以上。DB users 化は Phase 1 残課題 |
| B4 AI設定自由変更 | 修正 | settings 系を `require_admin_jwt` 限定 |
| B5 generated_by=system | 修正 | JWT sub を記録 |
| B6 JMA波浪URL404 | 部分対応 | 文書化＋鮮度ガード。NOWPHAS/有償Open-Meteo統合は Phase 3 |
| B7 鮮度ガードなし | 修正 | 気象60分・海象3時間（判定API・dashboard 共通） |
| B8 レポート全量出力 | 修正 | `require_hq_or_admin_jwt` 限定 |
| B10 レート制限既定無効 | 修正 | 既定 60 req/min |
| B11 取り込み上限 | 一部対応 | 物理範囲検証を追加。件数上限は Phase 2 |
| B12 リストア未整備 | 修正 | `wmcdss-db-restore.sh` 追加（--dry-run対応） |
| B14 JWT localStorage | 対応 | CSP 継続＋httpOnly Cookie化は Phase 3 |
| B16 異常値チェック | 修正 | observation スキーマで物理範囲を検証 |
| B17 Open-Meteo ライセンス | 文書化 | .env.production.example・本台帳に明記 |
