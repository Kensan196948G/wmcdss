# WMCDSS 改善台帳（2026-08-12）

> 本ファイルは 2026-08-12 の総合評価（docs/evaluation/）に基づく実装・検証の記録。
> 未実施・保留項目は「残課題」欄に明記する。

## 実施済み（Phase 0: 重大問題・セキュリティ）

| ID | 分類 | 内容 | 検証 |
|---|---|---|---|
| I1 | 認証 | 全業務API（GET含む）へ JWT 必須化。APIキーは書き込み機械連携用に維持（`get_current_user_or_anon` / `require_any_user_or_api_key`） | backend 357 / E2E 38 |
| I2 | RBAC | role クレーム発行（`WMCDSS_ROLE_USERS_RAW` / `WMCDSS_DEFAULT_ROLE`）。管理操作（現場登録・閾値・ETL・監査・AI設定）は admin、レポートは hq 以上、観測投入は API キー専用 | `test_rbac_dashboard_budget.py` |
| I3 | 監査 | `actor_from()` が JWT sub を X-Actor より優先。判定の `generated_by` に JWT ユーザー名を記録 | `test_actor_from_prefers_jwt_subject_over_x_actor` / `test_create_decision_records_generated_by_jwt_user` |
| I4 | AI | AI設定（APIキー・モデル）を admin 限定。日次リクエスト・月次トークン予算（429 / 警告ログ） | `_check_ai_budget` テスト |
| I5 | データ | 観測値の物理範囲検証（気温・風速・波高等）を API 境界で実施 | observation schema テスト |
| I6 | データ | 判定APIの鮮度ガード（気象60分・海象3時間）。古い観測値は欠測扱い（fail-closed） | `test_stale_weather_observation_is_treated_as_missing` |
| I7 | ダッシュボード | `/api/v1/dashboard` 集約エンドポイント（モック・生成値なし・鮮度フラグ付き） | `test_rbac_dashboard_budget.py` |
| I8 | フロント | ログイン後にだけバックエンド初期化（未認証 preflight の誤判定解消）。状態更新で警告帯を確実に表示 | E2E 38/38 |
| I9 | フロント | 判定画面・生成データの混在排除（backendConnected ガード）、風配図サンプル非表示、予報カードに「サンプル」明記 | vitest 587 / E2E |
| I10 | PWA | manifest.webmanifest 追加・index.html 連携 | build |
| I11 | 運用 | `wmcdss-db-restore.sh` 追加（--dry-run / 世代選択 / DB資格情報env連動） | スクリプトreview |
| I12 | 運用 | バックアップに gzip 整合性チェック・DBユーザー/DB名の env 連動 | スクリプトreview |
| I13 | CI | typecheck ジョブ追加・gitleaks シークレットスキャンジョブ追加 | ワークフローreview（GitHub復旧後に実効） |
| I14 | 設定 | レート制限の既定値を 60 req/min に（env省略時の総当たり防止） | backend テスト |
| I15 | 文書 | 評価文書5点・改善台帳・テスト証跡を追加。README/AUTH-DESIGN/SECURITY の乖離修正 | docs/ |

## 残課題（優先順）

| ID | 内容 | 理由 | 計画 |
|---|---|---|---|
| R1 | GitHub リポジトリ404（push/PR/CI 不能） | リポジトリが存在しない（要ユーザー判断） | リポジトリ再作成 or URL 変更 or 可視性変更 |
| R2 | 本番デプロイ先未確定（社内サーバー or Cloudflare/Neon） | 一意特定できない | ユーザー決定後にデプロイ・smoke |
| R3 | JMA波浪データ源の破損（URL404・観測局更新停止） | 外部要因。NOWPHAS 統合が Phase 3 | Phase 3 で NOWPHAS/有償 Open-Meteo へ |
| R4 | Open-Meteo 無料版は非商用限定 | ライセンス | 有償契約 or JMA/NOWPHAS 切替 |
| R5 | 予報業務許可の要否未確認 | 法令 | 法務確認（Phase 3） |
| R6 | ユーザー管理UI（role変更・無効化） | env ベース RBAC の制約 | Phase 1 で DB users 化＋管理UI |
| R7 | 通知（警戒・中止の自動発報） | 未実装 | Phase 1 |
| R8 | バックアップ外部退避・復旧ドリル | ローカル保存のみ | Phase 1 |
| R9 | 障害対応手順書・RTO/RPO 定義 | 未定義 | Phase 1 |
| R10 | M365 ROPC→対話型（PKCE）移行 | セキュリティ | Phase 2-3 |
