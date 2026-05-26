# 📊 WMCDSS — プロジェクトステータス（オフライン Projects 代替）

> このファイルは GitHub Projects と等価の役割を担う **ローカル可視化ボード** です。
> `git remote` 未設定環境のため、ここを Single Source of Truth とし、remote 構成後は
> GitHub Projects に転写します。

最終更新: **2026-05-27**（Phase 1 ESM port — `api.jsx → src/api.ts` 着地 — Loop 15 完）
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
| 🐍 Backend API | 🟢 100% | `3dce51d` | OpenAPI exposure env-gated ✅／レート制限 ✅／API key 認証 ✅ |
| 🗄️ DB マイグレーション | 🟢 100% | `95a64d5` | 本番マイグレーションリハ未実施 |
| ⏱️ JMA Ingester | 🟢 100% | `3ebf8fa` | AMeDAS + marine 分離完了。実 timer での連続稼働ログ／wave URL 実機検証 (Month 5) |
| 🔐 Auth / Audit | 🟢 100% | (pending) | 鍵ローテーション運用フロー未定。actor 漏洩経路除去＋strict audit 適用済み |
| 🖥️ Frontend | 🟡 87% | `738587c` | Vite scaffold ✅／Phase 1 `api.ts` ESM 化 ✅／残: app/dashboard/decisions 等 .jsx の ESM 移植 ／E2E |
| 🛠️ Infra (compose / systemd) | 🟢 95% | `96aab85` | `.env.production.example` 作成済 — `.env.production` は gitignore で保護 |
| 🤖 CI | 🟢 100% | `ff725b8` | 三段ジョブ all green ／setup-node@v6 で Node 24 runtime 化。Codex/CodeRabbit 連携 (#4) のみ残課題 |
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
| 9 | Build → Verify | RateLimitMiddleware 導入 — sliding window deque ／identity = `sha256(X-API-Key)[:16]` or IP ／CORS→RateLimit→APIKey の三段／unit +10 件 (41→51) all green ／CI run `26468154402` 30s green | ✅ b17aa2e |
| 10 | Build → Verify | CI smoke verify ジョブ追加 — `backend-smoke` job が compose 起動 → `/readyz` ポーリング → `pytest tests/test_api_smoke.py` (9 件) を実行。`needs: backend-unit` で純関数 fail を先に弾く二段構え。初回 push で exit 127 (`pytest` 未インストール) → dev extras を container 内に layered install するステップ追加 → CI run `26468562824` で unit 23s + smoke 40s 双方 green | ✅ 6d7b200 |
| 11 | Build → Verify | OpenAPI 本番公開ポリシー — `WMCDSS_EXPOSE_OPENAPI` (default true) ／false で `openapi_url=docs_url=redoc_url=None` を渡し `/openapi.json`・`/docs`・`/redoc` を 404 化。「dev open, prod locked」を `api_keys=[]` と同様の env スイッチで実装。unit +4 件 (51→55) — default-on / disabled / `/healthz` 残存 / `/` endpoints list 残存 を分離検証。`importlib.reload(main_mod)` で FastAPI ctor の `openapi_url` 固定をフィクスチャで覆す構造。CI run `26468982461` unit 24s + smoke 48s 双方 green | ✅ 3dce51d |
| 12 | Build | Vite Phase 0 scaffold (#1) — `frontend/vite-app/` に React 18 + Vite 6 + TS の toolchain を作成。既存 Babel Standalone (`frontend/index.html`) は無傷で fallback として残す方針。`npm run build` 検証: 26 modules transformed → **gzip 46.67 kB / 568ms**（既存構成は babel.min.js だけで ~3MB ロード）。`.gitignore` で node_modules + dist 除外、`package-lock.json` は commit して Phase 1 CI で再現可能性を担保。Phase 1 で `../*.jsx` を ES module として移植予定 | ✅ dc89b0b |
| 13 | Build → Verify | CI `frontend-build` ジョブ追加 — Phase 1 で `.jsx` を ESM 化する前に **gating を先に整備**。Node 22 + `npm ci` (lockfile-pinned) + `npm run build`。`needs:` なしで `backend-unit` と並走 → 壁時計時間据え置き。CI run `26469645882` で **frontend 9s ／ unit 26s ／ smoke 40s** all green。CI 産出物 `index-CkP53_s4.js` がローカルビルドとハッシュ一致 → reproducibility 確認済み。**新規 deprecation 警告: `actions/setup-node@v4` 内部 Node 20 runtime (2026-09-16 削除)** — Loop 14 で `@v5` 検証予定 (B6 候補) | ✅ d1978ed |
| 14 | Build → Verify | `actions/setup-node@v4 → @v6` バンプ — v5 で Node 24 runtime 化、v6 で npm auto-cache 縮退（明示指定済みなので無影響）。setup-python@v6 と対称化。CI run `26469869759` で **frontend 9s ／ unit 27s ／ smoke 46s** all green、annotations 0 件 → **deprecation 警告完全消滅で B6 解消**。9 月 16 日の Node 20 ランタイム削除前に窓を閉じた | ✅ ff725b8 |
| 15 | Build → Verify | Phase 1 narrow ESM port — `frontend/api.jsx`（5.7 KB IIFE）を `frontend/vite-app/src/api.ts`（TS 化 + named exports）に複製。**dual surface**: ESM exports（後続 .jsx → .tsx 移植先用）＋ `window.WMCDSS_API` / `WMCDSS_API_BASE` 副作用（Babel Standalone fallback 互換）。`App.jsx` から `import { WMCDSS_API_BASE }` で参照し tree-shake 回避。Bundle 影響: **26 → 27 modules / gzip 46.67 → 48.15 kB (+1.48 kB)**。CI run `26470239874` で **frontend 11s ／ unit 29s ／ smoke 48s** all green。ローカル/CI 双方で hash 完全一致 (`index-DhTHn0se.js / 148.14 kB`) — reproducibility 維持。最小 blast radius で原本 `api.jsx` は無傷（並列稼働 = Phase 2 で旧版引退） | ✅ 738587c |

---

## 🚧 ブロッカー / 要ユーザ判断

| # | ブロッカー | 状態 | 解消アクション |
|---:|---|:--:|---|
| ~~B1~~ | `git remote` 未設定 | ✅ 解消 | `Kensan196948G/wmcdss` private repo 作成・push 完了 (2026-05-26) |
| B2 | Codex / CodeRabbit レビューはユーザ起動のみ | 🟡 待 | Issue [#4](https://github.com/Kensan196948G/wmcdss/issues/4) — `/codex:review` ＋ `/coderabbit:review` 起動依頼 |
| B3 | AgentTeams 未活性化 | 🟡 部分解消 | 本セッションは個別 Agent 起動で代替中。`TeamCreate` 起動は CTO 判断で随時 |
| ~~B4~~ | 本番環境変数テンプレ未作成 | ✅ 解消 | `.env.production.example` 作成・`.gitignore` で `.env.production` 保護（Loop 7） |
| ~~B5~~ | Node.js 20 deprecation (2026-09-16) | ✅ 解消 | Issue [#3](https://github.com/Kensan196948G/wmcdss/issues/3) — `5c80fe7` で v5/v6 にバンプ済み |
| ~~B6~~ | `actions/setup-node@v4` 内部 Node 20 runtime (2026-09-16 削除予定) | ✅ 解消 | Loop 14 で `@v6` にバンプ（`ff725b8`）。CI run `26469869759` で annotations 0 件確認済み |

---

## 🗂️ コミット履歴（直近）

| SHA | 種別 | 内容 |
|---|---|---|
| `738587c` | feat | Phase 1 ESM port — `frontend/api.jsx` → `vite-app/src/api.ts` ／dual surface (ESM + window) ／bundle +1.48 kB gzip |
| `ff725b8` | ci | `actions/setup-node@v4 → @v6` バンプ — Node 24 runtime 化で B6 解消 ／annotations 0 件確認 |
| `d1978ed` | ci | `frontend-build` ジョブ追加 — Node 22 + `npm ci` + Vite build ／並走で wall-clock 据え置き ／run `26469645882` green |
| `dc89b0b` | feat | Vite Phase 0 scaffold — `frontend/vite-app/` ／React 18 + Vite 6 + TS ／gzip 46.67 kB build verified |
| `3dce51d` | feat | OpenAPI exposure env-gated — `WMCDSS_EXPOSE_OPENAPI=false` で /docs・/redoc・/openapi.json を 404 ／tests +4 |
| `6d7b200` | ci | smoke job 内で dev extras を layered install（exit 127 修正） |
| `847f11a` | ci | `backend-smoke` job 追加 — compose 起動 + `/readyz` ポーリング + smoke 9 件 |
| `b17aa2e` | feat | RateLimitMiddleware — sliding window per identity (key hash / IP) ／tests +10 |
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
