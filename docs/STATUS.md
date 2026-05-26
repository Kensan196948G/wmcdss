# 📊 WMCDSS — プロジェクトステータス（オフライン Projects 代替）

> このファイルは GitHub Projects と等価の役割を担う **ローカル可視化ボード** です。
> `git remote` 未設定環境のため、ここを Single Source of Truth とし、remote 構成後は
> GitHub Projects に転写します。

最終更新: **2026-05-27**（marine ingester 分離 — Issue #2 完）
リリース絶対期限: **2026-11-25** （登録から 6 ヶ月後 — CLAUDE.md 絶対厳守）
残日数: **約 182 日（Month 1 中盤）**
GitHub: [`Kensan196948G/wmcdss`](https://github.com/Kensan196948G/wmcdss) ／ [Project v2 #29](https://github.com/users/Kensan196948G/projects/29) ／ [Milestone #1 Production Release](https://github.com/Kensan196948G/wmcdss/milestone/1)

---

## 🎯 期間内マイルストーン

| フェーズ | 期間 | 状態 | 主要成果 |
|---|---|:--:|---|
| Month 1〜2 — 基盤整備 | 〜2026-07-25 | 🟢 進行中 | DB スキーマ ✅ ／ API ✅ ／ JMA ingest ✅ ／ Auth ✅ ／ Audit ✅ ／ CI ✅ |
| Month 3〜4 — 品質向上 | 〜2026-09-25 | ⚪ 未着手 | E2E ／ Codex+CodeRabbit 自動レビュー組込 ／ モニタリング |
| Month 5 — 統合テスト | 〜2026-10-25 | ⚪ 未着手 | 実現場 1 件で運用試験 |
| Month 6 — リリース準備 | 〜2026-11-25 | ⚪ 未着手 | CHANGELOG ／ タグ ／ 本番移行 |

---

## 🧱 コンポーネント別ステータス

| レイヤ | 進捗 | 直近コミット | 残課題 |
|---|:--:|---|---|
| 🐍 Backend API | 🟢 95% | `5c3f700` | OpenAPI スキーマ自動公開／レート制限 |
| 🗄️ DB マイグレーション | 🟢 100% | `95a64d5` | 本番マイグレーションリハ未実施 |
| ⏱️ JMA Ingester | 🟢 100% | `3ebf8fa` | AMeDAS + marine 分離完了。実 timer での連続稼働ログ／wave URL 実機検証 (Month 5) |
| 🔐 Auth / Audit | 🟢 100% | (pending) | 鍵ローテーション運用フロー未定。actor 漏洩経路除去＋strict audit 適用済み |
| 🖥️ Frontend | 🟡 80% | `3ac56d6` | バンドル化（Babel Standalone → Vite）／E2E |
| 🛠️ Infra (compose / systemd) | 🟢 95% | `96aab85` | `.env.production.example` 作成済 — `.env.production` は gitignore で保護 |
| 🤖 CI | 🟢 80% | `5c80fe7` | smoke verify ジョブ ／ Codex/CodeRabbit 連携 (#4) |
| 📚 Docs | 🟢 95% | `fc49421` | ARCHITECTURE.md §9 CI 二段構え追加済み |

---

## 🔄 進行中ループ — Monitor → Build → Verify → Improve

| 回 | フェーズ | 内容 | 結果 |
|---:|---|---|:--:|
| 1 | Build | audit hardening + smoke 9 件 + CI gate | ✅ 5c3f700 |
| 2 | Improve | README に CI バッジ／API 表更新／テスト件数 23+9／STATUS.md 新設 | ✅ fc49421 |
| 3 | Monitor → Build | git remote 設定／Issue 4 件生成／Project v2 #29 連携／Milestone #1 設定 | ✅ B1/B3 解消 |
| 4 | Verify | CI run `26466286004` ✅ 28s — ruff + pytest both green | ✅ |
| 5 | Improve | audit hardening — `_actor` API Key 漏洩除去／`write_audit(strict=True)` ／unit +9 (23→32) | ✅ |
| 6 | Build → Verify | CI Node 20 deprecation — `checkout@v5`／`setup-python@v6`／run `26467039494` 23s green／Issue #3 closed | ✅ 5c80fe7 |
| 7 | Build | `.env.production.example` 新設＋`.gitignore` で `.env.production` 保護（B4 解消） | ✅ 96aab85 |
| 8 | Build → Verify | marine ingester 分離（Issue #2）— `jma_wave` service + `ingest_jma_marine` job + hourly timer + unit テスト +9 件 (32→41)／CI run `26467717952` 28s green／Issue #2 closed | ✅ 3ebf8fa |

---

## 🚧 ブロッカー / 要ユーザ判断

| # | ブロッカー | 状態 | 解消アクション |
|---:|---|:--:|---|
| ~~B1~~ | `git remote` 未設定 | ✅ 解消 | `Kensan196948G/wmcdss` private repo 作成・push 完了 (2026-05-26) |
| B2 | Codex / CodeRabbit レビューはユーザ起動のみ | 🟡 待 | Issue [#4](https://github.com/Kensan196948G/wmcdss/issues/4) — `/codex:review` ＋ `/coderabbit:review` 起動依頼 |
| B3 | AgentTeams 未活性化 | 🟡 部分解消 | 本セッションは個別 Agent 起動で代替中。`TeamCreate` 起動は CTO 判断で随時 |
| ~~B4~~ | 本番環境変数テンプレ未作成 | ✅ 解消 | `.env.production.example` 作成・`.gitignore` で `.env.production` 保護（Loop 7） |
| ~~B5~~ | Node.js 20 deprecation (2026-09-16) | ✅ 解消 | Issue [#3](https://github.com/Kensan196948G/wmcdss/issues/3) — `5c80fe7` で v5/v6 にバンプ済み |

---

## 🗂️ コミット履歴（直近）

| SHA | 種別 | 内容 |
|---|---|---|
| `3ebf8fa` | feat | marine ingester 分離（`jma_wave` service ＋ `ingest_jma_marine` job ＋ hourly timer ＋ tests +9）— Issue #2 closed |
| `96aab85` | infra | `.env.production.example` 新設＋`.gitignore` 強化（B4 解消） |
| `5c80fe7` | ci | checkout@v5 + setup-python@v6 へバンプ（Node 20 deprecation 解消） |
| `24eb466` | harden | audit hardening — `_actor` API Key 漏洩除去＋`write_audit(strict=True)` |
| `fc49421` | docs | STATUS.md 新設＋ARCHITECTURE.md §9 CI 二段構え |
| `5c3f700` | feat | decision/site の audit 永続化＋オフライン CI gate |
| `e163429` | docs | hardening 後の SECURITY/README/systemd 整合 |
| `3ac56d6` | harden | ingester／audit／frontend の silent-failure ＋ auth 強化 |
| `95a64d5` | chore | scaffold（backend + frontend + ingester） |

---

## 📐 残日数連動の自動縮退（CLAUDE.md 抜粋）

| 残日数 | 縮退ルール | 適用予定日 |
|---:|---|---|
| 30 日以内 | Improvement 縮退・Verify/リリース準備優先 | 2026-10-26 〜 |
| 14 日以内 | 新機能開発禁止・バグ修正のみ | 2026-11-11 〜 |
| 7 日以内 | リリース準備のみ（CHANGELOG／タグ） | 2026-11-18 〜 |
