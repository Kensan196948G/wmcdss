# WMCDSS 文書・運用・インフラ・費用監査（2026-08-12）

対象: README / docs/* / deploy/ / scripts/ / .github/workflows/ci.yml / docker-compose* / .env.*.example

## 1. 文書-実装整合性（乖離一覧）

| # | 文書 | 記述 | 実態 | 重大度 |
|---|---|---|---|---|
| D1 | README | 「週間天気予報」を画面紹介 | バックエンド予報機能なし・生成データ | 高 |
| D2 | README | 「10分ごとに自動で取得」 | AMeDASはsystemdタイマー10分毎だが、データは3時間ブロックファイルの最新取得 | 中 |
| D3 | AUTH-DESIGN.md | 図に「JWTAuthMiddleware（既存APIKeyMiddlewareと共存）」 | そのようなミドルウェアは存在せず、JWTはroute別Depends | 高 |
| D4 | AUTH-DESIGN.md | 「一般ログイン＝ローカル管理者アカウント」 | 全従業員向けログインとしても使われる想定（600名） | 中 |
| D5 | SECURITY.md | 「操作者の不明化→audit_log(actor...)必ず記録」 | actorがUIからはanonymous（backend監査B2） | 高 |
| D6 | ARCHITECTURE.md | 図にusers/forecasts等の言及は一部 | users等が未使用（B13） | 中 |
| D7 | TECH-STACK.md | 前回監査で4件修正済み | 本評価では重大乖離を確認できず | 低 |
| D8 | STATUS.md | 「backend 338 + frontend 587 + E2E 38」 | 本評価で backend 344 / frontend 587 / E2E 38 を確認 | 整合 |
| D9 | README | 「スマホでも使えます」 | レスポンシブは実装済みだがPWA/オフラインは無し | 中 |
| D10 | README/ライセンス | 「社内利用（要件確定後に決定）」 | 本番導入前にライセンス未確定は契約リスク | 高 |

## 2. 運用手順の完全性

### 整備済み
- セットアップ（IT-STAFF.md、Windows11展開情報）、systemdユニット（サービス+タイマー2種）、migrationランナー、バックアップスクリプト（30世代・--clean）、監視（/readyz・/metrics・healthcheck）、鍵ローテーション手順（SECURITY.md §5）、AI設定ファイル必須化（PR #67）。

### 欠落・未検証
- リストア実行スクリプト・復旧ドリルの自動化（B12）
- アラート通知（Slack/メール）は「導入環境依存」のまま未設定
- 本番デプロイ先（社内サーバー or Cloudflare/Neon）が未確定
- バックアップの外部退避（別ホスト/クラウド）手順は推奨文のみ
- 障害対応RTO/RPO・インシデント手順書の明記なし
- ユーザー管理手順（誰がアカウントを追加・権限変更するか）が存在しない

## 3. CI/CD評価

### 実装済み（10ジョブ）
backend-unit（pytest+ruff）、backend-smoke（compose起動+9件）、frontend-unit（vitest 587）、frontend-build、frontend-image、frontend-e2e（Firefox 38）、backend-audit（pip-audit）、frontend-audit（npm audit）、dependabot（pip/npm/actions）。

### 欠落
- シークレットスキャン（gitleaks等）→ 追加予定
- coverageゲート（現状レポートのみ）
- デプロイ・スモークのworkflow（本番未構築のため保留）
- リリース（タグ・CHANGELOG）自動化

### 重大制約
- **GitHubリポジトリが404**（`git ls-remote origin` で Repository not found）。CI実行・PR・マージが現状不可能。原因調査と復旧（リポジトリ再作成・URL変更・可視性）が最優先の運用課題。

## 4. 費用対効果（概算・公開情報ベース）

| 構成 | 概算（月額） | 備考 |
|---|---|---|
| 現行: 社内Docker + Windows Server | サーバー償却/運用 数万円〜 | JMAデータは無料。ライセンス未確定 |
| 競合: KIYOMASA PRO | 1現場 13,200円/月 + 初期33,000円 | 予報業務許可83号・現場特化 |
| 競合: ウェザーニュース for business | 見積もり制（数十万円/年〜） | 1kmメッシュ予報・AIエージェント・IoTセンサー |
| 競合: ZEROSAI | 見積もり制（センサー含む） | NETIS登録・レーダー/予測/観測 |
| 将来: Cloudflare Pages + Workers + Neon | 無料枠〜1万円程度/月（規模次第） | バックエンドはPython/FastAPIのためWorkers移行は要設計 |
| AI (Claude API) | 従量（数千円〜数万円/月） | 利用上限設定が必須 |

WMCDSSの自社開発は、競合の「1現場月額1万円超×数百現場」と比較すると大幅に安価で、判定ロジック・監査証跡を自社で持てる点が最大の費用優位性。一方、予報・通知・センサー連携・予報業務許可の欠落で「業務を置き換えられる範囲」は限定される。

## 5. ライセンス・データ利用

- 気象庁データ: 数値データは著作権対象外・商用可・「気象庁提供」の出典明示が望ましい。本システムは `jma_user_agent` を設定済み。
- **予報業務許可**: WMCDSSが「予報」（将来の気象を加工・発表）をAI等で生成・表示する場合、気象業務法に基づく予報業務許可の要否を確認する必要がある。現状は「観測値+しきい値判定」だが、AI要約で予報的な表現を出さない設計・文書が必要。
- Open-Meteo: 無料APIは非商用限定。本番で「参考情報」表示に使う場合も有料契約またはJMA/NOWPHASへの切替が必要。
- OSS依存: FastAPI/SQLAlchemy/React等はMIT/BSD系。ライセンス表は未整備（Phase 3）。

## 6. 今すぐ修正すべきTOP10（本評価で対応）

1. GitHubリポジトリ復旧（ユーザー確認必須・ブロッカー）
2. READMEの予報・スマホ記述の是正（D1/D9）
3. AUTH-DESIGN.mdのJWTAuthMiddleware誤記修正（D3）
4. SECURITY.mdのRBAC・JWT必須化反映（D5）
5. ライセンス・予報業務許可・Open-Meteo注意書き（D10）
6. リストアスクリプト+手順（B12）
7. CIへのgitleaks追加（将来のCI復旧時に有効化）
8. STATUS.mdへ2026-08-12評価エントリ追加
9. 監視・アラートの導入先別設定手順をIT-STAFFに明記
10. 評価文書群（本ディレクトリ）と改善台帳をリポジトリ正本化
