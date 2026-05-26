# 📊 WMCDSS — プロジェクトステータス（オフライン Projects 代替）

> このファイルは GitHub Projects と等価の役割を担う **ローカル可視化ボード** です。
> `git remote` 未設定環境のため、ここを Single Source of Truth とし、remote 構成後は
> GitHub Projects に転写します。

最終更新: **2026-05-26**
リリース絶対期限: **2026-11-25** （登録から 6 ヶ月後 — CLAUDE.md 絶対厳守）
残日数: **約 183 日（Month 1 中盤）**

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
| ⏱️ JMA Ingester | 🟢 100% | `3ac56d6` | 実 timer での連続稼働ログ未取得 |
| 🔐 Auth / Audit | 🟢 100% | `5c3f700` | 鍵ローテーション運用フロー未定 |
| 🖥️ Frontend | 🟡 80% | `3ac56d6` | バンドル化（Babel Standalone → Vite）／E2E |
| 🛠️ Infra (compose / systemd) | 🟢 90% | `e163429` | 本番環境変数テンプレ未作成 |
| 🤖 CI | 🟢 60% | `5c3f700` | smoke の verify ジョブ ／ Codex/CodeRabbit 連携 |
| 📚 Docs | 🟢 90% | _本コミット_ | ARCHITECTURE.md に CI 図追加 |

---

## 🔄 進行中ループ — Monitor → Build → Verify → Improve

| 回 | フェーズ | 内容 | 結果 |
|---:|---|---|:--:|
| 1 | Build | audit hardening + smoke 9 件 + CI gate | ✅ 5c3f700 |
| 2 | Improve | README に CI バッジ／API 表更新／テスト件数 23+9 | ✅ 本コミット |
| 3 | Monitor | git remote 未設定／AgentTeams 未起動／Codex+CodeRabbit ユーザ起動待ち | 🟡 ブロッカー記録 |

---

## 🚧 ブロッカー / 要ユーザ判断

| # | ブロッカー | 影響 | 解消アクション（要承認） |
|---:|---|---|---|
| B1 | `git remote` 未設定 | GitHub Projects 同期不能・PR レビュー不能 | `gh repo create kensan/wmcdss --private --source=. --remote=origin --push` |
| B2 | Codex / CodeRabbit レビューはユーザ起動のみ | Verify フェーズ完走不能 | `/codex:review` ＋ `/coderabbit:review` を `5c3f700` に対し実行 |
| B3 | AgentTeams 未活性化 | 並列開発体制が未稼働 | チーム定義 → `Agent` 起動の指示が必要 |
| B4 | 本番環境変数テンプレ未作成 | デプロイ準備不能（Month 6 課題に先食い余地あり） | `.env.production.example` を Month 4 までに作成 |

---

## 🗂️ コミット履歴（直近）

| SHA | 種別 | 内容 |
|---|---|---|
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
