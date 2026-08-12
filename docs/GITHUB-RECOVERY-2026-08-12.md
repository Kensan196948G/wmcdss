# GitHub リポジトリ復旧の選択肢（2026-08-12 調査）

## 現状（実測）

- `git ls-remote https://github.com/Kensan196948G/wmcdss.git` → **Repository not found（404）**
- `gh api repos/Kensan196948G/wmcdss` → 404
- アカウント `Kensan196948G` には後継リポジトリ
  `Civil-Weather-Water-Decision`（private・2026-06-19作成・本日 push・CI green）が存在
- ローカルの wmcdss はコミット履歴を含めて完全に保持（branch `feat/2026-08-12-production-assessment` @ 5f97c91）

## 選択肢

### A. wmcdss リポジトリを再作成（private）して履歴を push
```bash
gh repo create wmcdss --private --source . --remote origin --push
```
- 利点: 現行評価・改善の履歴をそのまま GitHub 上で CI/PR 運用できる
- 注意: 旧 URL が削除された理由が不明（意図的な整理の可能性）→ 再作成前にユーザー確認

### B. CWW-D を正とし、wmcdss はローカルアーカイブ
- wmcdss のブランチを `git bundle` 等で退避し、開発は CWW-D へ一本化
- WMCDSS 独自資産は CWW-D へ移植（docs/DEPLOYMENT-OPTIONS-2026-08-12.md のマッピング参照）

### C. 別 URL / 別アカウントを正とする
- 正しい URL があれば `git remote set-url origin <URL>` で復旧

## 推奨

**A（再作成）を暫定対応としつつ、中長期的には B（CWW-D 統合）を推奨。**
まず wmcdss の履歴を GitHub 上に保全（A）し、統合判断は CWW-D の評価完了後に行うのが安全です。

**必要操作（ユーザー承認後）**: 上記 A のコマンド1行のみ。リポジトリは private で作成するため外部公開はされません。
