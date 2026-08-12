# WMCDSS テスト証跡（2026-08-12）

## 実行環境

- OS: Ubuntu 24.04（Docker 29.1.3 / Python 3.12.3 / Node 25.2.1）
- リポジトリ: `/home/kensan/Projects/Mirai-DX-Project/wmcdss`（main @ b087921 + 未コミット改善）
- 日時: 2026-08-12 22:20〜23:15 JST

## 結果一覧

| 検証 | コマンド | 結果 |
|---|---|---|
| backend 単体 | `pytest -q --ignore=tests/test_api_smoke.py` | **357 passed**（改善前 344） |
| backend lint | `ruff check .` | **All checks passed** |
| frontend 単体 | `npm test`（vitest） | **587 passed** |
| frontend 型検査 | `npm run typecheck`（tsc） | **成功** |
| frontend ビルド | `npm run build` | **成功**（gzip 114.88 kB JS） |
| E2E | `E2E_PORT=4176 CI=1 npx playwright test`（Firefox 38件） | **38 passed**（改善前ローカル同等） |
| compose 検証 | `docker compose -f docker-compose.yml config --quiet` | **成功** |
| 秘密スキャン | `git grep`（trackedコード） | **該当なし**（テストfixture除く） |
| JMA AMeDAS 実測 | `https://www.jma.go.jp/bosai/amedas/data/point/44132/...` | 200（取得可能） |
| JMA 波浪 実測 | 旧URL `.../wave/data/point/...` | **404（破損を確認）** |
| 代替JMA波浪 | `.../wave/data/swjp/{station}.json` | 200 だが 2026-03-25 で更新停止 |

## 追加テスト（本評価で実装）

- `test_stale_weather_observation_is_treated_as_missing`（判定鮮度ガード）
- `test_fresh_weather_observation_is_used`
- `test_create_decision_records_generated_by_jwt_user`
- 並行実装由来: `test_rbac_dashboard_budget.py`（actor優先・ロール解決・RBAC 401/403・ダッシュボード集約・AI予算・CSV無害化）

## 未実施（NOT RUN）

- GitHub Actions 全ジョブ（リポジトリ404のため実行不能）
- gitleaks 実スキャン（ローカル未導入。CI ジョブは追加済み）
- 本番 compose 起動・smoke（デプロイ先未確定のため保留）
- リストア実地ドリル（バックアップ実体が無いため保留。`--dry-run` は確認済み）
- 負荷・性能テスト（Phase 2）
