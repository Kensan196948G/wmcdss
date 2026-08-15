# WMCDSS デプロイ先の選択肢と推奨（2026-08-12）

> ユーザー判断が必要な項目です。本資料は決定に必要な情報を整理したものです。

## 選択肢 A: 社内サーバー（現行 docker-compose + systemd）

| 項目 | 内容 |
|---|---|
| 構成 | Windows Server / Linux + Docker Compose + systemd（既存の設計・手順） |
| 費用 | サーバー償却 + 運用（数万円/月〜） |
| セキュリティ | FortiGate / リバースプロキシでの TLS 終端が必要。M365 ROPC 利用時は平文送信厳禁 |
| 可用性 | 単一ホスト（HA なし）。バックアップ外部退避で RPO 24h を担保 |
| 適合 | 既存インフラ（Windows Server・M365・FortiGate）との親和性が高い。IT 7名で管理可能 |
| リスク | ハードウェア障害・NW 障害時の停止。DevOps 基盤が弱い |

## 選択肢 B: Cloudflare Pages + Workers + Neon PostgreSQL

| 項目 | 内容 |
|---|---|
| 構成 | 静的UI（Pages）+ API（Workers への Python 移植 or 常駐サーバー）+ Neon DB + Cloudflare Tunnel |
| 費用 | 無料枠〜1万円/月程度（規模次第）。Neon は無料枠〜 |
| セキュリティ | Cloudflare Access エッジ認証・TLS 標準・DDoS 緩和 |
| 可用性 | マルチリージョン・高可用。Tunnel で社内 API も公開可 |
| 適合 | **後継プロジェクト Civil-Weather-Water-Decision（CWW-D）が実績**（Neon + Cloudflare Tunnel/Access 構成で本日 v0.4.2・CI green） |
| リスク | FastAPI の Workers 移植は要設計（Python ランタイム制約）。既存 docker-compose 資産の移行作業 |

## 推奨

**B（Cloudflare + Neon）を基本とし、WMCDSS 単体ではなく後継 CWW-D へ統合することを推奨します。**

理由:
1. CWW-D は WMCDSS の拡張版（河川・WBGT・Entra OIDC・通知・現場別権限・SLO/Runbook を実装済み）
2. 本日（2026-08-12）v0.4.2 リリース・CI green・Cloudflare Tunnel + Neon 本番構成の実績あり
3. WMCDSS 独自資産（fail-closed 判定・監査スナップショット・鮮度ガード・NOWPHAS取り込み・評価文書）は CWW-D へ移植・統合が可能
4. 2系統を並行運用すると IT 7名の保守負荷が倍増する

**判断が必要な点**（ユーザー確認）:
- WMCDSS リポジトリを (a) 再作成して履歴ごと移行するか、(b) CWW-D を正として WMCDSS をアーカイブするか
- CWW-D への統合を行う場合は、WMCDSS の NOWPHAS 取り込み・判定鮮度ガード・評価文書を CWW-D へ移植する作業を承認するか

## 参考: CWW-D との資産マッピング

| WMCDSS 資産 | CWW-D 側の対応 |
|---|---|
| 判定エンジン（fail-closed） | decision_engine.py / assessment.py |
| 監査スナップショット | audit.py / decision_results |
| 鮮度ガード・物理範囲検証 | 同種実装（data_collectors） |
| NOWPHAS 取り込み（本評価で実装） | marine.py へ移植候補 |
| 評価文書・台帳・証跡 | docs/evaluation/2026-08-12-integrated-evaluation.md と統合 |
| バックアップ/リストア | docs/backup-restore.md に実装済み |
